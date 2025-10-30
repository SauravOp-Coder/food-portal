// src/Login.js
import React, { useState } from "react";
import { auth, db } from "./firebase";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignup, setIsSignup] = useState(false);
  const [role, setRole] = useState("user");

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (isSignup) {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await setDoc(doc(db, "users", cred.user.uid), {
          role,
          userID: cred.user.uid,
          plan: role === "user" ? { mealsRemaining: 30, chaiRemaining: 12 } : {},
          totalAmountPaid: role === "user" ? 1200 : 0
        });
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err) {
      console.error(err);
      alert(err.message);
    }
  };

  return (
    <div style={{ textAlign: "center", padding: 20 }}>
      <h2>{isSignup ? "Sign Up" : "Login"}</h2>
      <form onSubmit={handleSubmit}>
        <input placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} /><br/><br/>
        <input placeholder="Password" type="password" value={password} onChange={e=>setPassword(e.target.value)} /><br/><br/>
        {isSignup && (
          <select value={role} onChange={e=>setRole(e.target.value)}>
            <option value="user">User</option>
            <option value="owner">Owner</option>
          </select>
        )}
        <br/><br/>
        <button type="submit">{isSignup ? "Sign Up" : "Login"}</button>
      </form>
      <br/>
      <button onClick={() => setIsSignup(!isSignup)}>
        {isSignup ? "Already have an account?" : "Create an account"}
      </button>
    </div>
  );
}
