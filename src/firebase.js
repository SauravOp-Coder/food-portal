
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { initializeApp } from "firebase/app";
import { getStorage } from "firebase/storage";
// Import the functions you need from the SDKs you need

// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAksOL89NryE9Hnr9A11QlZV9OHEksC4ME",
  authDomain: "healthportal-a532e.firebaseapp.com",
  projectId: "healthportal-a532e",
  storageBucket: "healthportal-a532e.firebasestorage.app",
  messagingSenderId: "613447676493",
  appId: "1:613447676493:web:eedfad5d98a1bf348e6204"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app); // ✅ Added this line

export { auth, db, storage };