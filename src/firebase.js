import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getAuth } from "firebase/auth"; // Moved this to the top

const firebaseConfig = {
  apiKey: "AIzaSyChQcr6T4LjoWPtP6PyVbvXv5mXZR5GfqU",
  authDomain: "gidigritsmartagricdashboard1.firebaseapp.com",
  databaseURL: "https://gidigritsmartagricdashboard1-default-rtdb.firebaseio.com",
  projectId: "gidigritsmartagricdashboard1",
  storageBucket: "gidigritsmartagricdashboard1.firebasestorage.app",
  messagingSenderId: "1096122496548",
  appId: "1:1096122496548:web:ea7198875110c1a16dcab1"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Export the services so App.jsx can use them
export const db = getDatabase(app);
export const auth = getAuth(app);