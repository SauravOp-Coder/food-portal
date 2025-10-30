// src/App.js
import React, { useState, useEffect } from "react";
import { auth, db } from "./firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import Login from "./Login";
import OwnerPortal from "./Owner";
import UserPortal from "./UserPortal";
import PaymentPage from "./PaymentPage"; // 👈 new file

function App() {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [paymentStatus, setPaymentStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        const docRef = doc(db, "users", currentUser.uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          setRole(data.role);
          setPaymentStatus(data.paymentStatus || "pending");
        }
      } else {
        setUser(null);
        setRole(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  if (loading) return <p>Loading...</p>;
  if (!user) return <Login />;

  // OWNER ROLE
  if (role === "owner") return <OwnerPortal />;

  // USER ROLE — but check payment status first
  if (role === "user") {
    if (paymentStatus === "approved") {
      return <UserPortal userID={user.uid} />;
    } else {
      // User not verified yet — show Payment Page
      return <PaymentPage user={user} />;
    }
  }

  return <p>Invalid role.</p>;
}

export default App;
