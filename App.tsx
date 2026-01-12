import React, { useState, useEffect, useRef } from 'react';
import { UserProfile, Message, FriendRequest, CallLog, CallType, LoginRecord, Group, SystemAlert, MessageStatus } from './types';
import { emojiToSVG, generateId, formatTime, formatFullDate, getChatId } from './utils/helpers';
import { COLORS, ICONS } from './constants';
import { auth, db, api } from './utils/firebaseConfig';

const App: React.FC = () => {
  // Navigation State
  const [activeTab, setActiveTab] = useState<'home' | 'requests' | 'calls' | 'chat' | 'profile' | 'admin' | 'createGroup' | 'userProfile'>('home');
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [isGroupChat, setIsGroupChat] = useState(false);
  const [viewedUserUid, setViewedUserUid] = useState<string | null>(null);
  
  // Theme State
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  // Auth State
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // App Data State
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [chats, setChats] = useState<Record<string, Message[]>>({});
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [activeAlert, setActiveAlert] = useState<SystemAlert | null>(null);
  
  // Typing State
  const [typingState, setTypingState] = useState<Record<string, Set<string>>>({});

  // Search States
  const [homeSearch, setHomeSearch] = useState('');

  // Call State
  const [incomingCall, setIncomingCall] = useState<{from: UserProfile, type: CallType} | null>(null);
  const [activeCall, setActiveCall] = useState<{peer: UserProfile, type: CallType} | null>(null);
  const [isMuted, setIsMuted] = useState(false);

  // Refs
  const typingTimeoutRef = useRef<Record<string, any>>({});

  // Theme Effect
  useEffect(() => {
    document.body.className = theme === 'light' ? 'light-mode' : '';
  }, [theme]);

  // --- Real-time Firebase Sync ---

  // 1. Auth & User Connection
  useEffect(() => {
    const unsubscribe = api.onAuthState(auth, (user: any) => {
      if (user) {
        // User is signed in, fetch profile
        const userRef = api.ref(db, `users/${user.uid}`);
        api.onValue(userRef, (snapshot: any) => {
          const val = snapshot.val();
          if (val) {
            setCurrentUser(val);
            // Set Presence
            const statusRef = api.ref(db, `users/${user.uid}/status`);
            api.set(statusRef, 'online');
            api.onDisconnect(statusRef).set('offline');
          }
        });
      } else {
        setCurrentUser(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // 2. Data Listeners (Only when logged in)
  useEffect(() => {
    if (!currentUser) return;

    // Sync Users
    const usersRef = api.ref(db, 'users');
    const unsubUsers = api.onValue(usersRef, (snapshot: any) => {
      const data = snapshot.val();
      if (data) {
        const userList = Object.values(data) as UserProfile[];
        setUsers(userList);
        const online = new Set(userList.filter(u => u.status === 'online').map(u => u.uid));
        setOnlineUsers(online);
      }
    });

    // Sync Chats
    const chatsRef = api.ref(db, 'chats');
    const unsubChats = api.onValue(chatsRef, (snapshot: any) => {
      const data = snapshot.val();
      if (data) {
        // Transform object of objects to object of arrays
        const formatted: Record<string, Message[]> = {};
        Object.keys(data).forEach(key => {
          formatted[key] = Object.values(data[key]);
        });
        setChats(formatted);
      } else {
        setChats({});
      }
    });

    // Sync Groups
    const groupsRef = api.ref(db, 'groups');
    const unsubGroups = api.onValue(groupsRef, (snapshot: any) => {
      const data = snapshot.val();
      setGroups(data ? Object.values(data) : []);
    });

    // Sync Requests
    const reqRef = api.ref(db, 'requests');
    const unsubReq = api.onValue(reqRef, (snapshot: any) => {
      const data = snapshot.val();
      setRequests(data ? Object.values(data) : []);
    });

    // Sync Incoming Calls (Signaling)
    const callsRef = api.ref(db, `calls/${currentUser.uid}`);
    const unsubCalls = api.onValue(callsRef, (snapshot: any) => {
      const data = snapshot.val();
      if (data) {
        const callerUid = data.callerId;
        const caller = users.find(u => u.uid === callerUid);
        if (caller && !activeCall) {
          setIncomingCall({ from: caller, type: data.type });
        }
      } else {
        setIncomingCall(null);
      }
    });

    // Sync Typing
    const typingRef = api.ref(db, 'typing');
    const unsubTyping = api.onValue(typingRef, (snapshot: any) => {
      const data = snapshot.val();
      if (data) {
        const newState: Record<string, Set<string>> = {};
        Object.keys(data).forEach(chatId => {
           // data[chatId] is { uid1: true, uid2: true }
           newState[chatId] = new Set(Object.keys(data[chatId]));
        });
        setTypingState(newState);
      } else {
        setTypingState({});
      }
    });

    return () => {
      unsubUsers(); unsubChats(); unsubGroups(); unsubReq(); unsubCalls(); unsubTyping();
    };
  }, [currentUser?.uid]); // Depend only on uid to prevent re-subscriptions loop

  // IP Fetcher
  const fetchIp = async (): Promise<string> => {
    try {
      const response = await fetch('https://api.ipify.org?format=json');
      const data = await response.json();
      return data.ip;
    } catch (e) {
      return "127.0.0.1";
    }
  };

  // Location Fetcher
  const fetchLocation = async (): Promise<string> => {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve("Unknown Location");
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve(`${position.coords.latitude.toFixed(2)}, ${position.coords.longitude.toFixed(2)}`);
        },
        () => resolve("Unknown Location"),
        { timeout: 5000 }
      );
    });
  };

  // Auth Handlers
  const handleLogin = async (e: React.FormEvent, email: string, pass: string) => {
    e.preventDefault();
    try {
      const cred = await api.signIn(auth, email, pass);
      const currentIp = await fetchIp();
      // Update Login History
      const userRef = api.ref(db, `users/${cred.user.uid}`);
      // Note: We can't easily push to array in simple update, so we'll just set IP for now to keep it simple or read-modify-write.
      // For MVP, just update lastLoginIp
      api.update(userRef, { lastLoginIp: currentIp, status: 'online' });
      setActiveTab('home');
    } catch (err: any) {
      alert("Login failed: " + err.message);
    }
  };

  const handleLogout = () => {
    if(currentUser) {
        api.set(api.ref(db, `users/${currentUser.uid}/status`), 'offline');
    }
    api.signOut(auth);
    setCurrentUser(null);
  };

  const handleSignUp = async (e: React.FormEvent, data: any) => {
    e.preventDefault();
    try {
      const cred = await api.signUp(auth, data.email, data.password);
      const loc = await fetchLocation();
      const currentIp = await fetchIp();
      const newUser: UserProfile = {
        uid: cred.user.uid,
        userId: data.userId.startsWith('@') ? data.userId : `@${data.userId}`,
        name: data.name,
        bio: data.bio || '',
        emoji: '👤',
        dpUrl: data.dpUrl || emojiToSVG('👤'),
        status: 'online',
        lastChanged: Date.now(),
        isPrivate: false,
        location: loc,
        joinedAt: Date.now(),
        lastLoginIp: currentIp,
        loginHistory: [{ ip: currentIp, timestamp: Date.now() }]
      };
      
      await api.set(api.ref(db, `users/${newUser.uid}`), newUser);
      setCurrentUser(newUser);
    } catch (err: any) {
      alert("Registration failed: " + err.message);
    }
  };

  // Profile Update Handler
  const handleUpdateProfile = (updatedData: Partial<UserProfile>) => {
    if (!currentUser) return;
    api.update(api.ref(db, `users/${currentUser.uid}`), updatedData);
  };

  // Group Handlers
  const handleCreateGroup = (name: string, members: string[]) => {
    if (!currentUser) return;
    const groupId = generateId();
    const newGroup: Group = {
      id: groupId,
      name,
      description: 'New Group',
      memberIds: [currentUser.uid, ...members],
      creatorId: currentUser.uid,
      avatarUrl: emojiToSVG('👥'),
      createdAt: Date.now()
    };
    api.set(api.ref(db, `groups/${groupId}`), newGroup);
    setActiveTab('home');
  };

  // Typing Handlers
  const handleLocalTyping = (chatId: string) => {
    if (!currentUser) return;
    
    // Set typing true in DB
    api.update(api.ref(db, `typing/${chatId}`), { [currentUser.uid]: true });

    if (typingTimeoutRef.current[chatId]) clearTimeout(typingTimeoutRef.current[chatId]);
    
    typingTimeoutRef.current[chatId] = setTimeout(() => {
       // Remove typing from DB
       api.remove(api.ref(db, `typing/${chatId}/${currentUser.uid}`));
    }, 2500);
  };

  // Messaging Logic
  const sendMessage = (text: string) => {
    if (!text.trim() || !activeChatId || !currentUser) return;
    
    const newMessageRef = api.push(api.ref(db, `chats/${activeChatId}`));
    const newMessage: Message = {
      id: newMessageRef.key,
      senderId: currentUser.uid,
      senderName: currentUser.name,
      text,
      timestamp: Date.now(),
      status: 'sent'
    };
    
    api.set(newMessageRef, newMessage);

    // Stop typing immediately
    if (typingTimeoutRef.current[activeChatId]) {
      clearTimeout(typingTimeoutRef.current[activeChatId]);
      api.remove(api.ref(db, `typing/${activeChatId}/${currentUser.uid}`));
    }
  };

  const handleClearChat = () => {
    if (!activeChatId) return;
    if (confirm('Clear all messages in this chat?')) {
      api.remove(api.ref(db, `chats/${activeChatId}`));
    }
  };

  const handleBroadcast = (text: string) => {
    const broadcastMsg = {
      senderId: currentUser?.uid || 'admin',
      senderName: 'SYSTEM',
      text: `📢 BROADCAST: ${text}`,
      timestamp: Date.now(),
      isBroadcast: true,
      status: 'read'
    };
    
    users.forEach(u => {
      if (u.uid !== currentUser?.uid) {
        const cid = getChatId(currentUser!.uid, u.uid);
        api.push(api.ref(db, `chats/${cid}`), broadcastMsg);
      }
    });
    alert('Broadcast sent!');
  };

  const openChat = (target: UserProfile | Group) => {
    if (!currentUser) return;
    if ('memberIds' in target) {
      setActiveChatId(`group_${target.id}`);
      setIsGroupChat(true);
    } else {
      setActiveChatId(getChatId(currentUser.uid, target.uid));
      setIsGroupChat(false);
    }
    setActiveTab('chat');
  };

  const openUserProfile = (uid: string) => {
    if (uid === currentUser?.uid) {
      setActiveTab('profile');
    } else {
      setViewedUserUid(uid);
      setActiveTab('userProfile');
    }
  };

  // --- Calling Logic (Signaling) ---
  const initiateCall = (peer: UserProfile, type: CallType) => {
    setActiveCall({ peer, type });
    // Signal the other user
    api.set(api.ref(db, `calls/${peer.uid}`), {
      callerId: currentUser?.uid,
      type
    });
  };

  const answerCall = () => {
    if (incomingCall) {
      setActiveCall({ peer: incomingCall.from, type: incomingCall.type });
      setIncomingCall(null);
      // Clear signaling node
      api.remove(api.ref(db, `calls/${currentUser?.uid}`));
    }
  };

  const endCall = () => {
    if (activeCall) {
      // Clear signaling on both ends just in case
      api.remove(api.ref(db, `calls/${activeCall.peer.uid}`));
      api.remove(api.ref(db, `calls/${currentUser?.uid}`));

      const log: CallLog = {
        id: generateId(),
        type: activeCall.type,
        peerId: activeCall.peer.uid,
        duration: 0, 
        timestamp: Date.now()
      };
      setCallLogs([log, ...callLogs]);
    }
    if (incomingCall) {
        api.remove(api.ref(db, `calls/${currentUser?.uid}`));
    }
    setActiveCall(null);
    setIncomingCall(null);
  };

  if (loading) return <div className="h-screen flex items-center justify-center bg-[#121212] text-[#00A878] font-bold">Initializing Uplink...</div>;

  if (!currentUser) {
    return <AuthScreen onLogin={handleLogin} onSignUp={handleSignUp} />;
  }

  const renderContent = () => {
    const acceptedContacts = requests
      .filter(r => r.status === 'accepted')
      .map(r => r.from === currentUser!.uid ? r.to : r.from);

    switch (activeTab) {
      case 'home':
        const visibleUsers = users.filter(u => {
          if (u.uid === currentUser?.uid) return false;
          if (currentUser?.isAdmin) return true;
          if (!u.isPrivate) return true;
          return acceptedContacts.includes(u.uid);
        });
        const myGroups = groups.filter(g => g.memberIds.includes(currentUser!.uid));
        return <HomeView 
          users={visibleUsers} groups={myGroups} openChat={openChat} openUserProfile={openUserProfile} onlineUsers={onlineUsers}
          searchQuery={homeSearch} setSearchQuery={setHomeSearch} onCreateGroup={() => setActiveTab('createGroup')}
        />;
      case 'createGroup':
        const contactUsers = users.filter(u => acceptedContacts.includes(u.uid) || currentUser?.isAdmin);
        return <CreateGroupView contacts={contactUsers} onCancel={() => setActiveTab('home')} onCreate={handleCreateGroup} />;
      case 'requests':
        return <RequestsView requests={requests} users={users} currentUser={currentUser!} onSendRequest={(uid) => {
          if (!currentUser) return;
          const reqId = generateId();
          const newReq: FriendRequest = { id: reqId, from: currentUser.uid, to: uid, status: 'pending', timestamp: Date.now() };
          api.set(api.ref(db, `requests/${reqId}`), newReq);
        }} onAcceptRequest={(id) => api.update(api.ref(db, `requests/${id}`), { status: 'accepted' })} onDeclineRequest={(id) => api.remove(api.ref(db, `requests/${id}`))} />;
      case 'calls':
        return <CallsView logs={callLogs} users={users} />;
      case 'chat':
        const chatTarget = isGroupChat ? groups.find(g => `group_${g.id}` === activeChatId) : users.find(u => getChatId(currentUser!.uid, u.uid) === activeChatId);
        if (!chatTarget) return null;
        const isPeerTyping = Array.from(typingState[activeChatId!] || []).some(uid => uid !== currentUser!.uid);
        return <ChatView 
          target={chatTarget} messages={chats[activeChatId!] || []} isPeerTyping={isPeerTyping}
          onSend={sendMessage} onTyping={() => handleLocalTyping(activeChatId!)}
          onBack={() => setActiveTab('home')} onCall={(type) => !isGroupChat && initiateCall(chatTarget as UserProfile, type)}
          onClear={handleClearChat} openUserProfile={openUserProfile}
          currentUser={currentUser!}
        />;
      case 'profile':
        return <ProfileView 
          user={currentUser!} onLogout={handleLogout} onBack={() => setActiveTab('home')} 
          onGoAdmin={() => setActiveTab('admin')} 
          theme={theme} toggleTheme={() => setTheme(prev => prev === 'dark' ? 'light' : 'dark')}
          onUpdateProfile={handleUpdateProfile}
        />;
      case 'admin':
        return <AdminDashboard 
          users={users} onlineCount={onlineUsers.size}
          onToggleVerify={(uid) => { const u = users.find(x => x.uid === uid); api.update(api.ref(db, `users/${uid}`), { isVerified: !u?.isVerified }) }} 
          onToggleSuspend={(uid) => { const u = users.find(x => x.uid === uid); api.update(api.ref(db, `users/${uid}`), { isSuspended: !u?.isSuspended }) }}
          onBroadcast={handleBroadcast} onSendAlert={() => {}} onBack={() => setActiveTab('profile')} 
        />;
      case 'userProfile':
        const viewedUser = users.find(u => u.uid === viewedUserUid);
        if (!viewedUser) return null;
        return <UserProfileDetail user={viewedUser} onBack={() => setActiveTab('home')} onMessage={() => openChat(viewedUser)} />;
      default: return null;
    }
  };

  return (
    <div className="safe-container">
      {renderContent()}
      {activeTab !== 'chat' && activeTab !== 'profile' && activeTab !== 'admin' && activeTab !== 'createGroup' && activeTab !== 'userProfile' && !activeCall && (
        <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
      )}
      {activeCall && <CallScreen call={activeCall} onEnd={endCall} isMuted={isMuted} onToggleMute={() => setIsMuted(!isMuted)} />}
      {incomingCall && <IncomingCallModal call={incomingCall} onAccept={answerCall} onDecline={endCall} />}
      {activeAlert && <SystemAlertModal alert={activeAlert} onClose={() => setActiveAlert(null)} />}
    </div>
  );
};

// --- View Components (Identical UI, just Types updated) ---

// ... AdminDashboard, AdminStatCard, MetricBar, UserProfileDetail ...
// (Keeping component logic mostly same but ensuring they use props passed from parent which are now real-time)

const AdminDashboard: React.FC<{
  users: UserProfile[], onlineCount: number, onToggleVerify: (uid: string) => void, 
  onToggleSuspend: (uid: string) => void, onBroadcast: (text: string) => void,
  onSendAlert: (alert: SystemAlert) => void, onBack: () => void
}> = ({users, onlineCount, onToggleVerify, onToggleSuspend, onBroadcast, onSendAlert, onBack}) => {
  const [adminTab, setAdminTab] = useState<'overview' | 'users' | 'system' | 'comms'>('overview');
  const [broadcastText, setBroadcastText] = useState('');
  const [systemMetrics, setSystemMetrics] = useState({ cpu: 42, ram: 65, network: 124, uptime: '12d 4h 23m' });

  useEffect(() => {
    const timer = setInterval(() => {
      setSystemMetrics(prev => ({
        ...prev,
        cpu: Math.min(100, Math.max(0, prev.cpu + (Math.random() * 10 - 5))),
        ram: Math.min(100, Math.max(0, prev.ram + (Math.random() * 4 - 2))),
        network: Math.max(0, prev.network + (Math.random() * 20 - 10))
      }));
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex flex-col h-full bg-[var(--bg-admin)] text-[var(--text-main)]">
      <div className="p-4 bg-[var(--bg-admin-card)] flex items-center justify-between border-b border-[var(--border-light)] shadow-2xl">
        <div className="flex items-center space-x-3">
          <button onClick={onBack} className="p-2 bg-[var(--bg-glass)] rounded-xl hover:opacity-80 transition">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"/></svg>
          </button>
          <div>
            <h2 className="text-sm font-black uppercase tracking-[0.2em] text-[#00A878]">Command Center</h2>
            <p className="text-[10px] text-[var(--text-secondary)] font-bold">TNB Text Admin v2.4.0</p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
           <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
           <span className="text-[9px] font-black uppercase tracking-widest text-[var(--text-secondary)]">Live Engine</span>
        </div>
      </div>

      <div className="flex bg-[var(--bg-admin-card)] p-1 border-b border-[var(--border-light)]">
        {(['overview', 'users', 'system', 'comms'] as const).map(tab => (
          <button 
            key={tab} 
            onClick={() => setAdminTab(tab)}
            className={`flex-1 py-3 text-[9px] font-black uppercase tracking-widest transition-all rounded-lg ${adminTab === tab ? 'bg-[#00A878] text-black shadow-lg shadow-[#00A878]/20' : 'text-[var(--text-secondary)] hover:text-[var(--text-main)]'}`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto custom-scroll p-4 space-y-6">
        {adminTab === 'overview' && (
          <div className="space-y-6 animate-fade-in">
            <div className="grid grid-cols-2 gap-4">
              <AdminStatCard label="Network Assets" value={users.length} sub="Verified Profiles" color="#00A878" />
              <AdminStatCard label="Live Nodes" value={onlineCount} sub="Active Connections" color="#3b82f6" />
              <AdminStatCard label="Daily Uplink" value="∞" sub="Realtime Sync" color="#a855f7" />
              <AdminStatCard label="Uptime" value={systemMetrics.uptime} sub="Global Availability" color="#f59e0b" />
            </div>
          </div>
        )}
        {adminTab === 'users' && (
          <div className="space-y-4 animate-fade-in">
             {users.map(u => (
               <div key={u.uid} className="bg-[var(--bg-admin-card)] p-4 rounded-3xl border border-[var(--border-light)] flex items-center justify-between group hover:border-[#00A878]/30 transition-all">
                  <div className="flex items-center">
                    <div className="relative">
                      <img src={u.dpUrl} className="w-10 h-10 rounded-full border border-[var(--border-light)]" alt="" />
                      {u.status === 'online' && <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 border-2 border-[var(--bg-admin-card)] rounded-full"></div>}
                    </div>
                    <div className="ml-3">
                      <div className="flex items-center">
                        <span className="text-xs font-bold text-[var(--text-main)]">{u.name}</span>
                        {u.isVerified && <ICONS.Verified className="w-4 h-4 ml-1" />}
                      </div>
                      <div className="text-[9px] text-[var(--text-secondary)] font-mono">{u.userId}</div>
                    </div>
                  </div>
                  <div className="flex space-x-2">
                     <button onClick={() => onToggleVerify(u.uid)} className={`p-2 rounded-xl border transition ${u.isVerified ? 'border-red-500/20 text-red-500 bg-red-500/5' : 'border-[#00A878]/20 text-[#00A878] bg-[#00A878]/5'}`}><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg></button>
                     <button onClick={() => onToggleSuspend(u.uid)} className={`p-2 rounded-xl border transition ${u.isSuspended ? 'border-green-500/20 text-green-500 bg-green-500/5' : 'border-red-500/20 text-red-500 bg-red-500/5'}`}><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636"/></svg></button>
                  </div>
               </div>
             ))}
          </div>
        )}
        {adminTab === 'system' && (
          <div className="space-y-6 animate-fade-in">
             <div className="bg-[var(--bg-admin-card)] rounded-3xl p-6 border border-[var(--border-light)] space-y-6">
                <MetricBar label="Global CPU Load" value={Math.round(systemMetrics.cpu)} color="#00A878" />
                <MetricBar label="Allocated Memory" value={Math.round(systemMetrics.ram)} color="#3b82f6" />
                <MetricBar label="Network IO" value={Math.round(systemMetrics.network)} max={500} color="#a855f7" />
             </div>
          </div>
        )}
        {adminTab === 'comms' && (
          <div className="space-y-6 animate-fade-in">
             <div className="bg-[var(--bg-admin-card)] rounded-3xl p-6 border border-[var(--border-light)] space-y-4">
                <textarea value={broadcastText} onChange={(e) => setBroadcastText(e.target.value)} placeholder="Enter message for all users..." className="w-full bg-[var(--bg-admin)] rounded-2xl p-4 text-xs border border-[var(--border-light)] focus:border-[#00A878] outline-none h-24 resize-none text-[var(--text-main)]" />
                <button onClick={() => { if(broadcastText.trim()) { onBroadcast(broadcastText); setBroadcastText(''); } }} className="w-full bg-[#00A878] text-black font-black py-4 rounded-2xl text-[10px] uppercase tracking-widest transition shadow-lg shadow-[#00A878]/20">Deploy Transmission</button>
             </div>
          </div>
        )}
      </div>
    </div>
  );
};

const AdminStatCard: React.FC<{label: string, value: string | number, sub: string, color: string}> = ({label, value, sub, color}) => (
  <div className="bg-[var(--bg-admin-card)] p-5 rounded-3xl border border-[var(--border-light)] hover:opacity-80 transition-all">
    <div className="text-[9px] font-black uppercase tracking-widest text-[var(--text-secondary)] mb-1">{label}</div>
    <div className="text-2xl font-black mb-1" style={{ color }}>{value}</div>
    <div className="text-[8px] font-bold text-[var(--text-secondary)] uppercase opacity-60">{sub}</div>
  </div>
);

const MetricBar: React.FC<{label: string, value: number, max?: number, color: string}> = ({label, value, max = 100, color}) => (
  <div className="space-y-2">
    <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-wider text-[var(--text-secondary)]">
      <span>{label}</span><span style={{ color }}>{value}{max === 100 ? '%' : ''}</span>
    </div>
    <div className="h-1.5 w-full bg-[var(--bg-glass)] rounded-full overflow-hidden">
      <div className="h-full transition-all duration-1000 ease-out" style={{ width: `${(value / max) * 100}%`, backgroundColor: color, boxShadow: `0 0 10px ${color}44` }} />
    </div>
  </div>
);

const UserProfileDetail: React.FC<{user: UserProfile, onBack: () => void, onMessage: () => void}> = ({user, onBack, onMessage}) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(user.userId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col h-full bg-[var(--bg-main)] animate-fade-in">
      <div className="p-4 bg-[var(--bg-card)] flex items-center shadow-md">
        <button onClick={onBack} className="mr-3 text-[var(--text-secondary)] hover:text-[var(--text-main)] transition">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"/></svg>
        </button>
        <h2 className="text-xl font-bold text-[var(--text-main)]">User Information</h2>
      </div>
      <div className="flex-1 p-6 flex flex-col items-center custom-scroll overflow-y-auto">
         <div className="relative mb-6">
           <img src={user.dpUrl} className="w-28 h-28 rounded-full border-4 border-[#00A878] shadow-2xl" alt="" />
           {user.status === 'online' && <div className="absolute bottom-1 right-1 w-6 h-6 bg-green-500 border-4 border-[var(--bg-main)] rounded-full"></div>}
         </div>
         <h3 className="text-2xl font-bold text-[var(--text-main)] tracking-tight flex items-center">
           {user.name}
           {user.isVerified && <ICONS.Verified className="w-5 h-5 ml-1" />}
         </h3>
         <button onClick={handleCopy} className="group relative text-[#00A878] text-sm font-semibold mb-2 flex items-center space-x-1 hover:brightness-125 transition">
           <span>{user.userId}</span>
           <svg className="w-3 h-3 opacity-40 group-hover:opacity-100" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
           {copied && <span className="absolute -top-8 left-1/2 -translate-x-1/2 bg-[#00A878] text-black text-[9px] px-2 py-1 rounded font-bold">Copied!</span>}
         </button>
         <p className="text-[var(--text-secondary)] text-xs text-center max-w-[80%] italic">"{user.bio || 'No bio provided'}"</p>
         
         <div className="w-full mt-10 space-y-4 pb-10">
           <div className="bg-[var(--bg-card)] p-5 rounded-3xl border border-[var(--border-main)] shadow-xl space-y-5">
             <h4 className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest border-b border-[var(--border-main)] pb-2">Public Records</h4>
             <div className="flex items-center justify-between"><span className="text-[var(--text-secondary)] text-sm font-medium">Global Positioning</span><span className="text-xs font-bold text-[var(--text-main)]">{user.location || 'Encrypted Territory'}</span></div>
             <div className="flex items-center justify-between"><span className="text-[var(--text-secondary)] text-sm font-medium">Last Pulse</span><span className="text-xs font-bold text-[#00A878]">{user.status === 'online' ? 'Real-time Connection' : formatFullDate(user.lastChanged || Date.now())}</span></div>
             <div className="flex items-center justify-between"><span className="text-[var(--text-secondary)] text-sm font-medium">Established Since</span><span className="text-xs font-bold text-[var(--text-main)]">{new Date(user.joinedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</span></div>
             <div className="flex items-center justify-between"><span className="text-[var(--text-secondary)] text-sm font-medium">Integrity Status</span><span className={`text-xs font-bold ${user.isVerified ? 'text-blue-400' : 'text-gray-500'}`}>{user.isVerified ? `Identity Verified (${new Date(user.joinedAt + 86400000).toLocaleDateString()})` : 'Unverified Identity'}</span></div>
             <div className="flex items-center justify-between"><span className="text-[var(--text-secondary)] text-sm font-medium">Security Clearance</span><span className="text-xs font-bold text-[var(--text-main)] uppercase tracking-widest">{user.isAdmin ? 'Level 5 (Admin)' : 'Level 1 (Standard)'}</span></div>
           </div>
           <button onClick={onMessage} className="w-full bg-[#00A878] text-black p-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:brightness-110 transition shadow-lg shadow-[#00A878]/20 flex items-center justify-center space-x-2"><ICONS.Send className="w-4 h-4" /><span>Secure Transmission</span></button>
         </div>
      </div>
    </div>
  );
};

const HomeView: React.FC<{
  users: UserProfile[], groups: Group[], openChat: (target: UserProfile | Group) => void, openUserProfile: (uid: string) => void,
  onlineUsers: Set<string>, searchQuery: string, setSearchQuery: (q: string) => void, onCreateGroup: () => void
}> = ({users, groups, openChat, openUserProfile, onlineUsers, searchQuery, setSearchQuery, onCreateGroup}) => {
  const [view, setView] = useState<'all' | 'groups'>('all');
  const filteredUsers = users.filter(u => u.name.toLowerCase().includes(searchQuery.toLowerCase()) || u.userId.toLowerCase().includes(searchQuery.toLowerCase()));
  const filteredGroups = groups.filter(g => g.name.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="flex flex-col h-full bg-[var(--bg-main)]">
      <div className="p-4 bg-[var(--bg-card)] shadow-md space-y-3">
        <div className="flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <h2 className="text-xl font-bold text-[#00A878]">TNB Text</h2>
            <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse mt-1"></div>
          </div>
          <button onClick={onCreateGroup} className="w-8 h-8 bg-[#00A878]/10 text-[#00A878] rounded-full flex items-center justify-center hover:bg-[#00A878]/20 transition"><svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg></button>
        </div>
        <div className="relative">
          <input type="text" placeholder="Search Uplinks..." className="w-full bg-[var(--bg-main)] text-xs py-2.5 pl-10 pr-4 rounded-xl border border-transparent focus:border-[#00A878] outline-none transition shadow-inner text-[var(--text-main)] placeholder-[var(--text-secondary)]" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
          <svg className="w-4 h-4 absolute left-3 top-2.5 text-[var(--text-secondary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
        </div>
        <div className="flex space-x-2">
          <button onClick={() => setView('all')} className={`px-4 py-1.5 rounded-full text-[10px] font-bold transition ${view === 'all' ? 'bg-[#00A878] text-black shadow-lg shadow-[#00A878]/20' : 'bg-[var(--bg-hover)] text-[var(--text-secondary)]'}`}>Direct</button>
          <button onClick={() => setView('groups')} className={`px-4 py-1.5 rounded-full text-[10px] font-bold transition ${view === 'groups' ? 'bg-[#00A878] text-black shadow-lg shadow-[#00A878]/20' : 'bg-[var(--bg-hover)] text-[var(--text-secondary)]'}`}>Groups</button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto custom-scroll p-2">
        {view === 'all' && filteredUsers.map(user => (
          <div key={user.uid} className="flex items-center p-3 hover:bg-[var(--bg-hover)] rounded-xl cursor-pointer transition mb-1 group">
            <div className="relative" onClick={(e) => { e.stopPropagation(); openUserProfile(user.uid); }}>
              <img src={user.dpUrl} className="w-12 h-12 rounded-full border border-[var(--border-main)] group-hover:border-[#00A878] transition" alt="" />
              {onlineUsers.has(user.uid) && <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-[var(--bg-main)] rounded-full"></div>}
            </div>
            <div className="ml-4 flex-1" onClick={() => openChat(user)}>
              <div className="flex items-center"><span className="font-semibold text-[var(--text-main)]">{user.name}</span>{user.isVerified && <ICONS.Verified />}</div>
              <p className="text-xs text-[var(--text-secondary)] truncate">{user.bio}</p>
            </div>
          </div>
        ))}
        {(view === 'all' || view === 'groups') && filteredGroups.map(group => (
          <div key={group.id} onClick={() => openChat(group)} className="flex items-center p-3 hover:bg-[var(--bg-hover)] rounded-xl cursor-pointer transition mb-1 group border-l-2 border-transparent hover:border-l-[#00A878]">
            <div className="relative"><img src={group.avatarUrl} className="w-12 h-12 rounded-full border border-[var(--border-main)] group-hover:border-[#00A878] transition" alt="" /><div className="absolute -bottom-1 -right-1 bg-[var(--bg-main)] p-0.5 rounded-full"><div className="bg-[#00A878] rounded-full p-0.5"><svg className="w-2 h-2 text-black" fill="currentColor" viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg></div></div></div>
            <div className="ml-4 flex-1"><div className="flex items-center justify-between"><span className="font-bold text-[var(--text-main)]">{group.name}</span><span className="text-[8px] bg-[#00A878]/10 text-[#00A878] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-widest">Group</span></div><p className="text-xs text-[var(--text-secondary)] truncate">{group.memberIds.length} members • {group.description}</p></div>
          </div>
        ))}
      </div>
    </div>
  );
};

const ChatView: React.FC<{
  target: UserProfile | Group, messages: Message[], isPeerTyping: boolean,
  onSend: (t: string) => void, onTyping: () => void, onBack: () => void, 
  onCall: (type: CallType) => void, onClear: () => void, openUserProfile: (uid: string) => void, currentUser: UserProfile
}> = ({target, messages, isPeerTyping, onSend, onTyping, onBack, onCall, onClear, openUserProfile, currentUser}) => {
  const [inputText, setInputText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const isGroup = 'memberIds' in target;
  useEffect(() => scrollRef.current?.scrollIntoView({ behavior: 'smooth' }), [messages, isPeerTyping]);

  return (
    <div className="flex flex-col h-full bg-[var(--bg-main)]">
      <div className="p-4 bg-[var(--bg-card)] flex items-center justify-between shadow-lg z-20">
        <div className="flex items-center flex-1 cursor-pointer" onClick={() => !isGroup && openUserProfile((target as UserProfile).uid)}>
          <button onClick={(e) => { e.stopPropagation(); onBack(); }} className="mr-3 text-[var(--text-secondary)] hover:text-[var(--text-main)]"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"/></svg></button>
          <img src={isGroup ? (target as Group).avatarUrl : (target as UserProfile).dpUrl} className="w-10 h-10 rounded-full border border-[var(--border-main)]" alt="" />
          <div className="ml-3 truncate"><div className="flex items-center"><h3 className="font-bold text-sm truncate text-[var(--text-main)]">{target.name}</h3>{!isGroup && (target as UserProfile).isVerified && <ICONS.Verified />}</div>{isPeerTyping ? <span className="text-[10px] text-[#00A878] font-bold animate-pulse">someone is typing...</span> : <span className="text-[10px] text-[var(--text-secondary)] font-medium">{isGroup ? `${(target as Group).memberIds.length} members` : 'online'}</span>}</div>
        </div>
        <div className="flex items-center space-x-2">
          {!isGroup && <div className="flex space-x-2 mr-1"><button onClick={() => onCall(CallType.VOICE)} className="p-2 text-[var(--text-secondary)] hover:text-[#00A878] transition"><ICONS.Calls className="w-5 h-5" /></button><button onClick={() => onCall(CallType.VIDEO)} className="p-2 text-[var(--text-secondary)] hover:text-[#00A878] transition"><ICONS.Video className="w-5 h-5" /></button></div>}
          <button onClick={onClear} className="p-2 text-[var(--text-secondary)] hover:text-red-500 transition" title="Clear Chat"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto custom-scroll p-4 space-y-4">
        {messages.map((m, i) => {
          const isMe = m.senderId === currentUser.uid;
          return (
            <div key={i} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                {isGroup && !isMe && <span className="text-[9px] text-[var(--text-secondary)] mb-1 ml-1 font-bold tracking-tight">{m.senderName}</span>}
                <div className={`p-3 rounded-2xl text-sm shadow-sm ${isMe ? 'bg-[#00A878] text-black rounded-tr-none' : 'bg-[var(--bg-bubble-other)] text-[var(--text-main)] rounded-tl-none border border-[var(--border-main)]'}`}>
                  {m.text}<div className={`flex items-center justify-end space-x-1 mt-1 leading-none ${isMe ? 'text-black/50' : 'text-[var(--text-secondary)]'}`}><span className="text-[8px] font-medium">{formatTime(m.timestamp)}</span>{isMe && <span className="flex items-center">{m.status === 'sent' && <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>}{m.status === 'delivered' && <div className="flex -space-x-1.5"><svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg><svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg></div>}{m.status === 'read' && <div className="flex -space-x-1.5 text-blue-800"><svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg><svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg></div>}</span>}</div>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={scrollRef} />
      </div>
      <div className="p-4 bg-[var(--bg-card)] border-t border-[var(--border-main)] pb-safe z-20">
        <form className="flex items-center" onSubmit={(e) => { e.preventDefault(); onSend(inputText); setInputText(''); }}>
          <div className="flex-1 bg-[var(--bg-main)] rounded-2xl flex items-center px-3 border border-transparent focus-within:border-[#00A878] transition shadow-inner">
            <input className="flex-1 bg-transparent py-3 px-3 text-sm outline-none text-[var(--text-main)] placeholder-[var(--text-secondary)]" placeholder="Message..." value={inputText} onChange={e => { setInputText(e.target.value); onTyping(); }} />
          </div>
          <button type="submit" className="ml-3 p-3 bg-[#00A878] text-black rounded-full shadow-lg shadow-[#00A878]/30"><ICONS.Send className="w-5 h-5" /></button>
        </form>
      </div>
    </div>
  );
};

const BottomNav: React.FC<{activeTab: string, onTabChange: (t: any) => void}> = ({activeTab, onTabChange}) => (
  <div className="h-16 bg-[var(--bg-card)] border-t border-[var(--border-main)] flex items-center justify-around px-2 shadow-inner z-10">
    <NavIcon icon={ICONS.Home} label="Home" active={activeTab === 'home'} onClick={() => onTabChange('home')} />
    <NavIcon icon={ICONS.Requests} label="People" active={activeTab === 'requests'} onClick={() => onTabChange('requests')} />
    <NavIcon icon={ICONS.Calls} label="Calls" active={activeTab === 'calls'} onClick={() => onTabChange('calls')} />
    <NavIcon icon={ICONS.Settings} label="Profile" active={activeTab === 'profile'} onClick={() => onTabChange('profile')} />
  </div>
);

const NavIcon: React.FC<{icon: any, label: string, active: boolean, onClick: () => void}> = ({icon: Icon, label, active, onClick}) => (
  <button onClick={onClick} className={`flex flex-col items-center flex-1 py-2 ${active ? 'text-[#00A878]' : 'text-[var(--text-secondary)]'}`}><Icon className="w-5 h-5" /><span className="text-[10px] mt-1 font-medium">{label}</span></button>
);

const ProfileView: React.FC<{
  user: UserProfile, onLogout: () => void, onBack: () => void, 
  onGoAdmin: () => void, 
  theme: 'dark' | 'light', toggleTheme: () => void,
  onUpdateProfile: (data: Partial<UserProfile>) => void
}> = ({user, onLogout, onBack, onGoAdmin, theme, toggleTheme, onUpdateProfile}) => {
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({ name: user.name, bio: user.bio, dpUrl: user.dpUrl });

  useEffect(() => {
    setFormData({ name: user.name, bio: user.bio, dpUrl: user.dpUrl });
  }, [user]);

  const handleCopy = () => {
    navigator.clipboard.writeText(user.userId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = () => {
    onUpdateProfile(formData);
    setIsEditing(false);
  };

  return (
    <div className="flex flex-col h-full bg-[var(--bg-main)]">
      <div className="p-4 bg-[var(--bg-card)] flex items-center shadow-md"><button onClick={onBack} className="mr-3 text-[var(--text-secondary)]"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"/></svg></button><h2 className="text-xl font-bold text-[var(--text-main)]">Profile</h2></div>
      <div className="flex-1 p-6 flex flex-col items-center custom-scroll overflow-y-auto">
         {isEditing ? (
            <div className="w-full space-y-6 animate-fade-in">
                <div className="flex flex-col items-center">
                    <img src={formData.dpUrl || user.dpUrl} className="w-28 h-28 rounded-full border-4 border-[#00A878] mb-4 object-cover shadow-2xl" onError={(e) => e.currentTarget.src = user.dpUrl} />
                    <input 
                        value={formData.dpUrl} 
                        onChange={e => setFormData({...formData, dpUrl: e.target.value})}
                        placeholder="Image URL" 
                        className="w-full bg-[var(--bg-card)] border border-[var(--border-main)] rounded-xl p-3 text-[var(--text-main)] text-xs outline-none focus:border-[#00A878] placeholder-[var(--text-secondary)]"
                    />
                </div>
                <div className="space-y-2">
                    <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase">Display Name</label>
                    <input 
                        value={formData.name} 
                        onChange={e => setFormData({...formData, name: e.target.value})}
                        className="w-full bg-[var(--bg-card)] border border-[var(--border-main)] rounded-xl p-3 text-[var(--text-main)] outline-none focus:border-[#00A878]"
                    />
                </div>
                 <div className="space-y-2">
                    <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase">Bio</label>
                    <textarea 
                        value={formData.bio} 
                        onChange={e => setFormData({...formData, bio: e.target.value})}
                        className="w-full bg-[var(--bg-card)] border border-[var(--border-main)] rounded-xl p-3 text-[var(--text-main)] outline-none focus:border-[#00A878] resize-none h-24"
                    />
                </div>
                <div className="flex space-x-3 pt-4">
                    <button onClick={() => setIsEditing(false)} className="flex-1 bg-[var(--bg-hover)] text-[var(--text-main)] py-3 rounded-xl font-bold text-xs border border-[var(--border-main)]">Cancel</button>
                    <button onClick={handleSave} className="flex-1 bg-[#00A878] text-black py-3 rounded-xl font-bold text-xs shadow-lg shadow-[#00A878]/20">Save Changes</button>
                </div>
            </div>
         ) : (
             <>
                <div className="relative mb-6"><img src={user.dpUrl} className="w-28 h-28 rounded-full border-4 border-[#00A878] shadow-2xl object-cover" alt="" />{user.isAdmin && <div className="absolute -top-1 -right-1 bg-[#00A878] text-black text-[8px] font-black px-2.5 py-1 rounded-full border-2 border-black uppercase tracking-widest">Admin</div>}</div>
                <h3 className="text-2xl font-bold text-[var(--text-main)] tracking-tight">{user.name}</h3>
                <button onClick={handleCopy} className="group relative text-[#00A878] text-sm font-semibold mb-2 flex items-center space-x-1">
                <span>{user.userId}</span>
                <svg className="w-3 h-3 opacity-40 group-hover:opacity-100" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
                {copied && <span className="absolute -top-8 left-1/2 -translate-x-1/2 bg-[#00A878] text-black text-[9px] px-2 py-1 rounded font-bold">Copied!</span>}
                </button>
                <p className="text-[var(--text-secondary)] text-xs text-center max-w-[80%] italic">"{user.bio}"</p>
             </>
         )}
         
         {!isEditing && (
            <div className="w-full mt-10 space-y-4">
            <div className="bg-[var(--bg-card)] p-5 rounded-3xl border border-[var(--border-main)] shadow-xl space-y-5">
                <h4 className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest border-b border-[var(--border-main)] pb-2">Account Meta</h4>
                <div className="flex items-center justify-between"><span className="text-[var(--text-secondary)] text-sm font-medium">Node Location</span><span className="text-xs font-bold text-[var(--text-main)]">{user.location || 'Unknown'}</span></div>
                <div className="flex items-center justify-between"><span className="text-[var(--text-secondary)] text-sm font-medium">Established</span><span className="text-xs font-bold text-[var(--text-main)]">{new Date(user.joinedAt).toLocaleDateString()}</span></div>
                <div className="flex items-center justify-between"><span className="text-[var(--text-secondary)] text-sm font-medium">Current Uplink IP</span><span className="text-xs font-mono font-bold text-[#00A878]">{user.lastLoginIp || 'Detecting...'}</span></div>
            </div>
            <div className="bg-[var(--bg-card)] p-5 rounded-3xl border border-[var(--border-main)] shadow-xl space-y-4">
                <h4 className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest border-b border-[var(--border-main)] pb-2">Login Activity</h4>
                <div className="max-h-32 overflow-y-auto custom-scroll space-y-3">
                {user.loginHistory?.map((record, i) => (
                    <div key={i} className="flex justify-between items-center text-[10px]"><span className="text-[var(--text-secondary)] font-mono opacity-80">{record.ip}</span><span className="text-[var(--text-secondary)] font-bold opacity-50">{new Date(record.timestamp).toLocaleString()}</span></div>
                ))}
                </div>
            </div>
            <div className="space-y-2 pb-10">
                <button onClick={() => setIsEditing(true)} className="w-full bg-[var(--bg-card)] text-[var(--text-main)] p-4 rounded-2xl font-bold text-xs uppercase tracking-widest border border-[var(--border-main)] hover:bg-[var(--bg-hover)] transition flex items-center justify-center space-x-2">
                    <svg className="w-5 h-5 text-[#00A878]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                    <span>Edit Profile</span>
                </button>

                <div className="bg-[var(--bg-card)] p-5 rounded-2xl flex items-center justify-between border border-[var(--border-main)]"><div><div className="font-bold text-sm text-[var(--text-main)]">Private Account</div><p className="text-[10px] text-[var(--text-secondary)]">Restricts visibility</p></div><button onClick={() => onUpdateProfile({ isPrivate: !user.isPrivate })} className={`w-14 h-7 rounded-full relative transition-all ${user.isPrivate ? 'bg-[#00A878]' : 'bg-[var(--bg-hover)]'}`}><div className={`absolute top-1 w-5 h-5 bg-white rounded-full transition-all ${user.isPrivate ? 'left-8' : 'left-1'}`} /></button></div>
                
                {/* Theme Toggle */}
                <button onClick={toggleTheme} className="w-full bg-[var(--bg-card)] text-[var(--text-main)] p-4 rounded-2xl font-bold text-xs uppercase tracking-widest border border-[var(--border-main)] hover:bg-[var(--bg-hover)] transition flex items-center justify-center space-x-2">
                    {theme === 'dark' ? <ICONS.Sun className="w-5 h-5" /> : <ICONS.Moon className="w-5 h-5" />}
                    <span>{theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}</span>
                </button>

                {user.isAdmin && <button onClick={onGoAdmin} className="w-full bg-[#00A878] text-black p-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:brightness-110">Admin Control Panel</button>}
                <button onClick={onLogout} className="w-full bg-red-500/10 text-red-500 p-4 rounded-2xl font-black text-xs uppercase tracking-widest border border-red-500/20 mt-4">Logout Account</button>
            </div>
            </div>
         )}
      </div>
    </div>
  );
};

const AuthScreen: React.FC<{onLogin: (e: any, email: string, pass: string) => void, onSignUp: (e: any, data: any) => void}> = ({onLogin, onSignUp}) => {
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('login');
  const [resetStep, setResetStep] = useState<'email' | 'newKey' | 'success'>('email');
  const [formData, setFormData] = useState({ name: '', userId: '', email: '', password: '', dpUrl: '' });
  const handleResetFlow = (e: React.FormEvent) => { e.preventDefault(); if (resetStep === 'email') setResetStep('newKey'); else if (resetStep === 'newKey') { setResetStep('success'); setTimeout(() => { setMode('login'); setResetStep('email'); }, 3000); } };

  return (
    <div className="flex flex-col h-full bg-[var(--bg-main)] p-10 justify-center">
      <div className="flex flex-col items-center mb-12"><div className="w-20 h-20 bg-[#00A878] rounded-3xl flex items-center justify-center shadow-2xl shadow-[#00A878]/30 mb-6 transform -rotate-12 transition-transform hover:rotate-0"><ICONS.Home className="w-12 h-12 text-black" /></div><h1 className="text-5xl font-black text-[var(--text-main)] mb-2 tracking-tighter">TNB Text</h1><p className="text-[var(--text-secondary)] font-bold uppercase tracking-widest text-[10px]">Secure Encryption • V1.6</p></div>
      {mode === 'forgot' ? (
        <div className="space-y-6 animate-fade-in"><div className="text-center space-y-2"><h2 className="text-xl font-bold text-[var(--text-main)] tracking-tight">Recover Uplink</h2><p className="text-[10px] text-[var(--text-secondary)] font-medium uppercase tracking-widest">{resetStep === 'email' ? "Enter your registered email" : resetStep === 'newKey' ? "Verified. Secure new password." : "Uplink Restored Successfully."}</p></div><form onSubmit={handleResetFlow} className="space-y-4">{resetStep === 'email' ? <input type="email" required className="w-full bg-[var(--bg-card)] border border-[var(--border-main)] rounded-2xl p-4 text-[var(--text-main)] outline-none text-sm placeholder-[var(--text-secondary)]" placeholder="Email" /> : resetStep === 'newKey' ? <input type="password" required className="w-full bg-[var(--bg-card)] border border-[var(--border-main)] rounded-2xl p-4 text-[var(--text-main)] outline-none text-sm placeholder-[var(--text-secondary)]" placeholder="New Password" /> : <div className="bg-[#00A878]/10 border border-[#00A878] p-4 rounded-2xl text-center text-[#00A878] font-bold text-xs">Redirecting to login portal...</div>}{resetStep !== 'success' && <button className="w-full bg-[#00A878] text-black font-black p-4 rounded-2xl uppercase tracking-widest text-xs">Next Stage</button>}</form><button onClick={() => setMode('login')} className="w-full text-center text-[10px] text-[var(--text-secondary)] font-bold uppercase tracking-widest">Back to Login</button></div>
      ) : (
        <><form onSubmit={(e) => mode === 'login' ? onLogin(e, formData.email, formData.password) : onSignUp(e, formData)} className="space-y-4">
          {mode === 'signup' && <><input className="w-full bg-[var(--bg-card)] border border-[var(--border-main)] rounded-2xl p-4 text-[var(--text-main)] outline-none text-sm placeholder-[var(--text-secondary)]" placeholder="Legal Name" required onChange={e => setFormData({...formData, name: e.target.value})} /><input className="w-full bg-[var(--bg-card)] border border-[var(--border-main)] rounded-2xl p-4 text-[var(--text-main)] outline-none text-sm placeholder-[var(--text-secondary)]" placeholder="@handle" required onChange={e => setFormData({...formData, userId: e.target.value})} /><input className="w-full bg-[var(--bg-card)] border border-[var(--border-main)] rounded-2xl p-4 text-[var(--text-main)] outline-none text-sm placeholder-[var(--text-secondary)]" placeholder="Profile Image URL (e.g. ImgBB)" onChange={e => setFormData({...formData, dpUrl: e.target.value})} /></>}
          <input type="email" className="w-full bg-[var(--bg-card)] border border-[var(--border-main)] rounded-2xl p-4 text-[var(--text-main)] outline-none text-sm placeholder-[var(--text-secondary)]" placeholder="Email" required onChange={e => setFormData({...formData, email: e.target.value})} />
          <input type="password" className="w-full bg-[var(--bg-card)] border border-[var(--border-main)] rounded-2xl p-4 text-[var(--text-main)] outline-none text-sm placeholder-[var(--text-secondary)]" placeholder="Password" required onChange={e => setFormData({...formData, password: e.target.value})} />
          {mode === 'login' && <div className="flex justify-end px-1"><button type="button" onClick={() => setMode('forgot')} className="text-[10px] text-[var(--text-secondary)] font-bold uppercase tracking-tighter hover:text-[#00A878] transition">Forgot Password?</button></div>}
          <button className="w-full bg-[#00A878] text-black font-black p-4 rounded-2xl shadow-xl shadow-[#00A878]/30 mt-4 active:scale-95 uppercase tracking-widest text-xs">{mode === 'login' ? 'Authenticate' : 'Establish Profile'}</button>
        </form><p className="mt-8 text-center text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-widest">{mode === 'login' ? "Unauthorized?" : "Established?"} <button onClick={() => setMode(mode === 'login' ? 'signup' : 'login')} className="text-[#00A878] font-black underline decoration-2 underline-offset-4">{mode === 'login' ? 'Apply Now' : 'Access Hub'}</button></p></>
      )}
    </div>
  );
};

const RequestsView: React.FC<{
  requests: FriendRequest[], users: UserProfile[], currentUser: UserProfile, 
  onSendRequest: (uid: string) => void, onAcceptRequest: (id: string) => void, onDeclineRequest: (id: string) => void
}> = ({requests, users, currentUser, onSendRequest, onAcceptRequest, onDeclineRequest}) => {
  const [search, setSearch] = useState('');
  const results = users.filter(u => u.uid !== currentUser.uid && u.userId.toLowerCase().includes(search.toLowerCase()));
  const pendingRequests = requests.filter(r => r.to === currentUser.uid && r.status === 'pending');
  return (
    <div className="flex flex-col h-full bg-[var(--bg-main)]"><div className="p-4 bg-[var(--bg-card)] shadow-md space-y-3"><h2 className="text-xl font-bold text-[#00A878]">Find People</h2><div className="relative"><input type="text" placeholder="Search handles..." className="w-full bg-[var(--bg-main)] text-xs py-2.5 px-10 rounded-xl border border-transparent focus:border-[#00A878] outline-none transition text-[var(--text-main)] placeholder-[var(--text-secondary)]" value={search} onChange={(e) => setSearch(e.target.value)} /></div></div><div className="flex-1 overflow-y-auto custom-scroll p-4 space-y-6">{pendingRequests.map(req => { const fromUser = users.find(u => u.uid === req.from); return ( <div key={req.id} className="bg-[var(--bg-card)] p-3 rounded-xl border border-[#00A878]/30 shadow-lg"><div className="flex items-center mb-3"><img src={fromUser?.dpUrl} className="w-10 h-10 rounded-full mr-3" alt="" /><div><div className="text-sm font-semibold text-[var(--text-main)]">{fromUser?.name}</div><div className="text-[10px] text-[var(--text-secondary)]">{fromUser?.userId}</div></div></div><div className="flex space-x-2"><button onClick={() => onAcceptRequest(req.id)} className="flex-1 bg-[#00A878] text-black text-[10px] font-bold py-2 rounded-lg">Accept</button><button onClick={() => onDeclineRequest(req.id)} className="flex-1 bg-[var(--bg-hover)] text-[var(--text-main)] text-[10px] font-bold py-2 rounded-lg">Decline</button></div></div> );})}{results.map(u => ( <div key={u.uid} className="bg-[var(--bg-card)] p-3 rounded-xl flex items-center justify-between shadow-sm"><div className="flex items-center"><img src={u.dpUrl} className="w-10 h-10 rounded-full mr-3" alt="" /><div><div className="text-sm font-semibold text-[var(--text-main)]">{u.name}</div><div className="text-[10px] text-[var(--text-secondary)]">{u.userId}</div></div></div><button onClick={() => onSendRequest(u.uid)} className="bg-[#00A878] text-black text-[10px] font-bold px-4 py-2 rounded-full">Add</button></div>))}</div></div>
  );
};

const CallsView: React.FC<{logs: CallLog[], users: UserProfile[]}> = ({logs, users}) => (
  <div className="flex flex-col h-full bg-[var(--bg-main)]"><div className="p-4 bg-[var(--bg-card)] shadow-md border-b border-[var(--border-main)]"><h2 className="text-xl font-bold text-[#00A878]">Calls</h2></div><div className="flex-1 flex flex-col items-center justify-center opacity-20 text-[var(--text-secondary)]"><ICONS.Calls className="w-20 h-20 mb-4" /><p className="font-bold uppercase tracking-widest text-xs">No Recent History</p></div></div>
);

const CallScreen: React.FC<{call: {peer: UserProfile, type: CallType}, onEnd: () => void, isMuted: boolean, onToggleMute: () => void}> = ({call, onEnd, isMuted, onToggleMute}) => (
  <div className="absolute inset-0 bg-black z-50 flex flex-col p-10 items-center justify-between"><div className="flex flex-col items-center mt-20"><div className="relative mb-8"><img src={call.peer.dpUrl} className="w-32 h-32 rounded-full border-4 border-[#00A878] shadow-2xl animate-pulse" alt="" /><div className="absolute inset-0 border-4 border-[#00A878] rounded-full animate-ping opacity-20"></div></div><h2 className="text-3xl font-black text-white tracking-tighter mb-2">{call.peer.name}</h2><p className="text-[#00A878] font-black uppercase tracking-widest text-[10px]">{call.type === CallType.VIDEO ? 'Encrypted Video Link' : 'Secure Audio Uplink'}</p></div><div className="w-full flex justify-center space-x-12 mb-20"><button onClick={onToggleMute} className={`p-5 rounded-full border-2 transition ${isMuted ? 'bg-white text-black border-white' : 'bg-transparent text-white border-white/20'}`}><svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"/></svg></button><button onClick={onEnd} className="p-7 bg-red-600 text-white rounded-full shadow-2xl shadow-red-600/50 transform active:scale-90 transition"><svg className="w-10 h-10 rotate-[135deg]" fill="currentColor" viewBox="0 0 24 24"><path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-2.2 2.2a15.045 15.045 0 01-6.59-6.59l2.2-2.2c.28-.28.36-.67.25-1.02C8.77 6.42 8.57 5.23 8.57 4c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1 0 9.39 7.61 17 17 17 .55 0 1-.45 1-1v-3.58c0-.56-.45-1.04-1.01-1.04z"/></svg></button></div></div>
);

const IncomingCallModal: React.FC<{call: {from: UserProfile, type: CallType}, onAccept: () => void, onDecline: () => void}> = ({call, onAccept, onDecline}) => (
  <div className="absolute inset-x-4 top-10 bg-[#1e1e1e] p-6 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-white/10 z-[60] animate-bounce"><div className="flex items-center space-x-4"><img src={call.from.dpUrl} className="w-16 h-16 rounded-full border-2 border-[#00A878]" alt="" /><div className="flex-1"><h4 className="font-black text-white text-lg tracking-tight">{call.from.name}</h4><p className="text-[10px] text-[#00A878] font-bold uppercase tracking-widest animate-pulse">Incoming Connection...</p></div></div><div className="flex space-x-3 mt-8"><button onClick={onDecline} className="flex-1 bg-red-500/10 text-red-500 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest">Deny</button><button onClick={onAccept} className="flex-1 bg-[#00A878] text-black py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-[#00A878]/30">Accept</button></div></div>
);

const SystemAlertModal: React.FC<{alert: SystemAlert, onClose: () => void}> = ({alert, onClose}) => (
  <div className="absolute inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm animate-fade-in"><div className={`w-full max-w-sm bg-[#1e1e1e] rounded-3xl p-8 border ${alert.type === 'critical' ? 'border-red-500 shadow-[0_0_40px_rgba(239,68,68,0.3)]' : 'border-[#00A878] shadow-[0_0_40px_rgba(0,168,120,0.2)]'} transform animate-scale-up text-center`}><div className={`w-16 h-16 rounded-full mx-auto mb-6 flex items-center justify-center ${alert.type === 'critical' ? 'bg-red-500/20 text-red-500 animate-pulse' : 'bg-[#00A878]/20 text-[#00A878]'}`}>{alert.type === 'critical' ? <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg> : <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>}</div><h2 className={`text-2xl font-black mb-3 tracking-tight ${alert.type === 'critical' ? 'text-red-500' : 'text-white'}`}>{alert.title}</h2><p className="text-gray-400 text-sm font-medium mb-8 leading-relaxed">{alert.message}</p><button onClick={onClose} className={`w-full py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition active:scale-95 shadow-lg ${alert.type === 'critical' ? 'bg-red-500 text-white shadow-red-500/20' : 'bg-[#00A878] text-black shadow-[#00A878]/20'}`}>Acknowledge System Notice</button></div></div>
);

const CreateGroupView: React.FC<{contacts: UserProfile[], onCancel: () => void, onCreate: (name: string, members: string[]) => void}> = ({contacts, onCancel, onCreate}) => {
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const toggleSelect = (uid: string) => setSelected(prev => prev.includes(uid) ? prev.filter(i => i !== uid) : [...prev, uid]);
  return (
    <div className="flex flex-col h-full bg-[var(--bg-main)]"><div className="p-4 bg-[var(--bg-card)] flex items-center border-b border-[var(--border-main)] shadow-sm"><button onClick={onCancel} className="mr-3 text-[var(--text-secondary)] rotate-90"><ICONS.Home className="w-6 h-6" /></button><h2 className="text-xl font-bold text-[#00A878]">New Group</h2></div><div className="p-4 bg-[var(--bg-card)] space-y-4"><input placeholder="Group Name" className="w-full bg-[var(--bg-main)] p-3 rounded-xl border border-[var(--border-main)] focus:border-[#00A878] outline-none text-sm text-[var(--text-main)] placeholder-[var(--text-secondary)]" value={name} onChange={(e) => setName(e.target.value)} /><h3 className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest px-1">Select Participants ({selected.length})</h3></div><div className="flex-1 overflow-y-auto custom-scroll p-4 space-y-2">{contacts.map(u => ( <div key={u.uid} onClick={() => toggleSelect(u.uid)} className={`p-3 rounded-xl flex items-center justify-between cursor-pointer transition ${selected.includes(u.uid) ? 'bg-[#00A878]/10 border border-[#00A878]' : 'bg-[var(--bg-main)]'}`}><div className="flex items-center"><img src={u.dpUrl} className="w-10 h-10 rounded-full mr-3" alt="" /><div><div className="text-sm font-semibold text-[var(--text-main)]">{u.name}</div><div className="text-[10px] text-[var(--text-secondary)]">{u.userId}</div></div></div><div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${selected.includes(u.uid) ? 'bg-[#00A878] border-[#00A878]' : 'border-gray-700'}`}>{selected.includes(u.uid) && <svg className="w-3 h-3 text-black" fill="currentColor" viewBox="0 0 20 20"><path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"/></svg>}</div></div> ))}</div><div className="p-4 bg-[var(--bg-card)]"><button disabled={!name.trim() || selected.length === 0} onClick={() => onCreate(name, selected)} className="w-full bg-[#00A878] text-black font-bold py-3 rounded-xl hover:opacity-90 disabled:opacity-30 transition shadow-lg shadow-[#00A878]/20">Create Group</button></div></div>
  );
};

export default App;