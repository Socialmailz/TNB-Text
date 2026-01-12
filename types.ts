
export type UserStatus = 'online' | 'offline';

export interface LoginRecord {
  ip: string;
  timestamp: number;
}

export interface UserProfile {
  uid: string;
  userId: string; // The @handle
  name: string;
  bio: string;
  emoji: string;
  dpUrl: string;
  status: UserStatus;
  lastChanged: number;
  isVerified?: boolean;
  isPrivate?: boolean;
  isAdmin?: boolean;
  isSuspended?: boolean;
  location?: string;
  joinedAt: number;
  lastLoginIp?: string;
  loginHistory?: LoginRecord[];
}

export interface Group {
  id: string;
  name: string;
  description: string;
  memberIds: string[];
  creatorId: string;
  avatarUrl: string;
  createdAt: number;
}

export type MessageStatus = 'sent' | 'delivered' | 'read';

export interface Message {
  id: string;
  senderId: string;
  senderName?: string; // Helpful for groups
  text: string;
  timestamp: number;
  isBroadcast?: boolean;
  status?: MessageStatus;
}

export interface SystemAlert {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'critical';
  targetType: 'all' | 'specific';
  targetUids?: string[];
}

export interface ChatThread {
  chatId: string;
  participants: string[];
  lastMessage?: string;
  lastTimestamp?: number;
  clearedAt?: number;
}

export interface FriendRequest {
  id: string;
  from: string;
  to: string;
  status: 'pending' | 'accepted' | 'declined';
  timestamp: number;
}

export enum CallType {
  VOICE = 'voice',
  VIDEO = 'video',
  MISSED = 'missed'
}

export interface CallLog {
  id: string;
  type: CallType;
  peerId: string;
  duration: number;
  timestamp: number;
}
