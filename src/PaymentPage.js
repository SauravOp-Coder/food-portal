// src/PaymentPage.js
import React, { useState } from "react";
import { db } from "./firebase";
import { doc, updateDoc, setDoc, getDoc } from "firebase/firestore";

export default function PaymentPage({ user }) {
  const [form, setForm] = useState({
    name: "",
    mobile: "",
    address: "",
  });
  const [screenshot, setScreenshot] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);

  // handle profile input
  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  // Handle image selection
  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const fileType = file.type;
    if (fileType !== "image/jpeg" && fileType !== "image/png") {
      alert("Only JPG and PNG images are allowed!");
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      setScreenshot(reader.result); // Base64 string
      setPreview(reader.result);
    };
    reader.readAsDataURL(file);
  };

  // Upload (actually just save Base64 + user details in Firestore)
  const handleUpload = async () => {
    if (!form.name || !form.mobile || !form.address) {
      return alert("Please fill all profile details first!");
    }
    if (!screenshot) return alert("Please upload your payment receipt first!");

    setLoading(true);
    try {
      const userRef = doc(db, "users", user.uid);
      const docSnap = await getDoc(userRef);

      if (!docSnap.exists()) {
        await setDoc(userRef, {
          email: user.email,
          name: form.name,
          mobile: form.mobile,
          address: form.address,
          plan: {
            price: 1200,
            mealsLimit: 30,
            chaiLimit: 12,
            paid: false,
            paymentSubmitted: true,
            paymentApprovedAt: null,
          },
          paymentScreenshot: screenshot,
          paymentStatus: "pending",
          createdAt: new Date(),
        });
      } else {
        await updateDoc(userRef, {
          name: form.name,
          mobile: form.mobile,
          address: form.address,
          paymentScreenshot: screenshot,
          "plan.price": 1200,
          "plan.mealsLimit": 30,
          "plan.chaiLimit": 12,
          "plan.paid": false,
          "plan.paymentSubmitted": true,
          paymentStatus: "pending",
          updatedAt: new Date(),
        });
      }

      alert("✅ Payment uploaded! Wait for owner approval.");
      setScreenshot(null);
      setPreview(null);
      setForm({ name: "", mobile: "", address: "" });
    } catch (error) {
      console.error("Error saving payment:", error);
      alert("❌ Failed to upload payment. Try again.");
    }

    setLoading(false);
  };

  return (
    <div style={container}>
      <h2>👤 Complete Your Profile & Payment</h2>
      <p>Plan: ₹1200/month (30 Meals + 12 Chais)</p>

      {/* --- USER INFO FORM --- */}
      <div style={card}>
        <h3>Step 1: Fill Your Profile Details</h3>
        <input
          name="name"
          placeholder="Full Name"
          value={form.name}
          onChange={handleChange}
          style={input}
        />
        <input
          name="mobile"
          placeholder="Mobile Number"
          value={form.mobile}
          onChange={handleChange}
          style={input}
        />
        <input
          name="address"
          placeholder="Address"
          value={form.address}
          onChange={handleChange}
          style={input}
        />
      </div>

      {/* --- PAYMENT SECTION --- */}
      <div style={card}>
        <h3>Step 2: Pay for the Plan</h3>
        <p>Scan QR and pay using UPI:</p>
        <img
          src="/qr.png"
          alt="QR Code"
          width="180"
          style={{ borderRadius: "8px", marginBottom: "10px" }}
        />
        <br />
        <a
          href="upi://pay?pa=merchant@upi&pn=FoodPortal&am=1200&cu=INR"
          style={{ textDecoration: "none" }}
        >
          <button style={button}>Pay Now via UPI</button>
        </a>
      </div>

      {/* --- RECEIPT UPLOAD --- */}
      <div style={card}>
        <h3>Step 3: Upload Payment Receipt Screenshot</h3>
        <input
          type="file"
          accept="image/png, image/jpeg"
          onChange={handleImageChange}
          style={{ marginBottom: "10px" }}
        />
        {preview && (
          <div>
            <img
              src={preview}
              alt="Receipt Preview"
              width="200"
              style={{ borderRadius: "8px", marginTop: "10px" }}
            />
          </div>
        )}
        <br />
        <button onClick={handleUpload} disabled={loading} style={button}>
          {loading ? "Uploading..." : "Submit for Verification"}
        </button>
      </div>
    </div>
  );
}

// simple inline styles
const container = {
  textAlign: "center",
  marginTop: "20px",
  fontFamily: "Arial, sans-serif",
};

const card = {
  border: "1px solid #ddd",
  borderRadius: "10px",
  padding: "16px",
  margin: "16px auto",
  width: "340px",
  backgroundColor: "#fff",
  boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
};

const input = {
  display: "block",
  width: "90%",
  margin: "8px auto",
  padding: "8px",
  borderRadius: "6px",
  border: "1px solid #ccc",
};

const button = {
  backgroundColor: "#007bff",
  color: "#fff",
  border: "none",
  padding: "10px 20px",
  borderRadius: "6px",
  cursor: "pointer",
};
