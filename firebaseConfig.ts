import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged } from "firebase/auth";
import { getDatabase, ref, set, push, onValue, update, remove, get, child, onDisconnect, serverTimestamp } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyC7jmAbAytHhS6AcWDrwg3sszsLC7aRagQ",
  authDomain: "tnb-text.firebaseapp.com",
  databaseURL: "https://tnb-text-default-rtdb.firebaseio.com",
  projectId: "tnb-text",
  storageBucket: "tnb-text.appspot.com",
  messagingSenderId: "206237617684",
  appId: "1:206237617684:web:d251f226728b1065b2a101",
  measurementId: "G-GVVH1WEH55"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);

export const api = {
  signIn: signInWithEmailAndPassword,
  signUp: createUserWithEmailAndPassword,
  signOut,
  onAuthState: onAuthStateChanged,
  ref,
  set,
  push,
  onValue,
  update,
  remove,
  get,
  child,
  onDisconnect,
  serverTimestamp
};