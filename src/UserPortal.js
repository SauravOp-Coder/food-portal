// src/UserPortal.js
import React, { useEffect, useMemo, useRef, useState } from "react";
import { auth, db } from "./firebase";
import { signOut } from "firebase/auth";
import {
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  orderBy,
  serverTimestamp,
  doc,
  updateDoc,
  getDoc,
} from "firebase/firestore";

/**
 * Final UserPortal.js (clean, no syntax errors)
 * - Hardcoded MENU (easy to change later)
 * - Per-item max occurrences = 5 per plan (counts distinct plan orders that include an item)
 * - Plan capacity = 30 meals per plan (counts plan orders in plan period)
 * - Approved orders appear in Approved Orders section
 * - KPIs update live via Firestore listeners
 * - Receipt upload uses base64 (works on Firebase free plan)
 *
 * Usage:
 * <UserPortal userID={uid} isOwner={false} />
 */

const MENU = [
  { id: "mix-veg-sandwich", name: "Mix Veg Sandwich", category: "Sandwich", price: 65, calories: 340 },
  { id: "tofu-sandwich", name: "Tofu Sandwich", category: "Sandwich", price: 85, calories: 380 },
  { id: "paneer-sandwich", name: "Paneer Sandwich", category: "Sandwich", price: 95, calories: 490 },
  { id: "avocado-grill", name: "Avocado Grill Sandwich", category: "Sandwich", price: 95, calories: 330 },

  { id: "date-almond", name: "Date Almond Energizer", category: "Smoothie", price: 85, calories: 380 },
  { id: "melon-mint", name: "Melon Mint Cooler", category: "Smoothie", price: 75, calories: 150 },
  { id: "beet-berry", name: "Beet Berry Power", category: "Smoothie", price: 85, calories: 230 },
  { id: "berrylicious", name: "Berrylicious Glow", category: "Smoothie", price: 95, calories: 210 },

  { id: "tropical-oats", name: "Tropical Fruit & Honey Oats", category: "Oats Bowl", price: 85, calories: 545 },
  { id: "dark-choco-oats", name: "Dark Chocolate Oats", category: "Oats Bowl", price: 95, calories: 575 },
  { id: "coffee-oats", name: "Coffee Flavoured Oats", category: "Oats Bowl", price: 105, calories: 555 },

  { id: "peanut-cucumber", name: "Peanut Cucumber", category: "Salad", price: 95, calories: 440 },
  { id: "black-chana", name: "Black Chana Salad", category: "Salad", price: 75, calories: 360 },
  { id: "soya-chunk", name: "Soya Chunk Power Bowl", category: "Salad", price: 95, calories: 400 },
  { id: "avocado-tomato", name: "Avocado Tomato", category: "Salad", price: 115, calories: 460 },
];

const PER_ITEM_MAX = 5;
const PLAN_CAPACITY = 30;

function formatDate(ts) {
  if (!ts) return "N/A";
  try {
    if (ts.toDate) return ts.toDate().toLocaleString();
    return new Date(ts).toLocaleString();
  } catch {
    return "N/A";
  }
}

const UserPortal = ({ userID, isOwner = false }) => {
  // states
  const [profile, setProfile] = useState(null);
  const [orders, setOrders] = useState([]); // user's orders
  const [allOrders, setAllOrders] = useState([]); // owner only
  const [ownerUsers, setOwnerUsers] = useState([]); // owner only
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState({});
  const [receiptFile, setReceiptFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [section, setSection] = useState("catalog"); // catalog | checkout | approvedHistory | account | owner
  const [editMode, setEditMode] = useState(false);
  const [formData, setFormData] = useState({});
  const prevOrdersRef = useRef({}); // to detect status transitions

  // load profile
  useEffect(() => {
    if (!userID) return;
    const unsub = onSnapshot(doc(db, "users", userID), (snap) => {
      if (snap.exists()) setProfile({ uid: snap.id, ...snap.data() });
      else setProfile(null);
      setLoading(false);
    });
    return () => unsub();
  }, [userID]);

  // listen to user's orders
  useEffect(() => {
    if (!userID) return;
    const q = query(collection(db, "Orders"), where("userID", "==", userID), orderBy("date", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      const arr = [];
      snap.forEach((d) => arr.push({ id: d.id, ...d.data() }));
      // detect pending->approved transitions for notifications
      const prev = prevOrdersRef.current;
      arr.forEach((o) => {
        const prevStatus = prev[o.id];
        if (prevStatus && prevStatus !== "approved" && o.status === "approved") {
          alert("✅ Your order has been approved! Check Approved Orders.");
        }
      });
      const map = {};
      arr.forEach((o) => (map[o.id] = o.status));
      prevOrdersRef.current = map;
      setOrders(arr);
    });
    return () => unsub();
  }, [userID]);

  // owner listeners
  useEffect(() => {
    if (!isOwner) return;
    const unsubAllOrders = onSnapshot(query(collection(db, "Orders"), orderBy("date", "desc")), (snap) => {
      const arr = [];
      snap.forEach((d) => arr.push({ id: d.id, ...d.data() }));
      setAllOrders(arr);
    });
    const unsubUsers = onSnapshot(collection(db, "users"), (snap) => {
      const a = [];
      snap.forEach((d) => a.push({ id: d.id, ...d.data() }));
      setOwnerUsers(a);
    });
    return () => {
      unsubAllOrders();
      unsubUsers();
    };
  }, [isOwner]);

  // derived KPI values
  const totalOrders = useMemo(() => orders.length, [orders]);
  const totalExpense = useMemo(() => orders.reduce((s, o) => s + Number(o.totalPrice || 0), 0), [orders]);

  // plan helpers
  const planStart = profile?.plan?.startDate
    ? (profile.plan.startDate.toDate ? profile.plan.startDate.toDate() : new Date(profile.plan.startDate))
    : null;
  const planEnd = profile?.plan?.endDate
    ? (profile.plan.endDate.toDate ? profile.plan.endDate.toDate() : new Date(profile.plan.endDate))
    : null;
  const planPaid = Boolean(profile?.plan?.paid);

  // user's plan orders in current plan period (pending + approved)
  const userPlanOrders = useMemo(() => {
    if (!planPaid || !planStart || !planEnd) return [];
    return orders.filter((o) => {
      if (o.isExtraOrder) return false;
      const oDate = o.date && o.date.toDate ? o.date.toDate() : (o.date ? new Date(o.date) : new Date());
      return oDate >= planStart && oDate <= planEnd;
    });
  }, [orders, planPaid, planStart, planEnd]);

  // count total meals used/pending in plan
  const planUsedCount = useMemo(() => {
    return userPlanOrders.reduce((s, o) => s + ((o.items || []).reduce((si, it) => si + (it.quantity || 0), 0) || 0), 0);
  }, [userPlanOrders]);

  const planRemaining = Math.max(0, PLAN_CAPACITY - planUsedCount);

  // per-item occurrence counts in current plan: count distinct plan orders that include that item
  const itemPlanCounts = useMemo(() => {
    const map = {};
    // use order id uniqueness to avoid double counting an item inside same order multiple times
    userPlanOrders.forEach((o) => {
      const items = o.items || [];
      items.forEach((it) => {
        if (!map[it.id]) map[it.id] = 0;
        map[it.id] += 1; // count order-occurrence
      });
    });
    return map;
  }, [userPlanOrders]);

  // CART helpers
  const cartTotalQty = useMemo(() => Object.values(cart).reduce((s, n) => s + n, 0), [cart]);

  const addToCart = (itemId) => {
    if (planPaid) {
      if (planRemaining <= 0) {
        alert("Plan capacity reached. Please renew your plan to order more.");
        return;
      }
      const occ = itemPlanCounts[itemId] || 0;
      if (occ >= PER_ITEM_MAX) {
        alert("This item is maxed for your current plan.");
        return;
      }
      if (cartTotalQty + 1 > planRemaining) {
        alert("Adding this will exceed your plan capacity. Please reduce cart or renew plan.");
        return;
      }
    }
    setCart((p) => ({ ...p, [itemId]: (p[itemId] || 0) + 1 }));
  };

  const removeFromCart = (itemId) => {
    setCart((p) => {
      if (!p[itemId]) return p;
      const next = { ...p };
      next[itemId] = Math.max(0, next[itemId] - 1);
      if (next[itemId] === 0) delete next[itemId];
      return next;
    });
  };

  const setCartQty = (itemId, qty) => {
    const q = Math.max(0, Math.min(10, qty));
    setCart((p) => ({ ...p, [itemId]: q }));
  };

  const clearCart = () => setCart({});

  // checkout: create order doc
  const handleCheckout = async () => {
    if (!profile) return alert("Profile not loaded.");
    const items = Object.entries(cart).map(([id, qty]) => {
      const meta = MENU.find((m) => m.id === id) || { name: id, price: 0 };
      return { id, name: meta.name, quantity: qty, price: meta.price || 0 };
    });
    if (items.length === 0) return alert("Cart is empty.");
    const totalQty = items.reduce((s, it) => s + it.quantity, 0);
    const totalPrice = items.reduce((s, it) => s + it.quantity * (it.price || 0), 0);

    let isExtraOrder = true;
    if (planPaid) {
      if (totalQty <= planRemaining) isExtraOrder = false;
      else isExtraOrder = true;
    } else isExtraOrder = true;

    try {
      await addDoc(collection(db, "Orders"), {
        userID,
        items,
        totalQty,
        totalPrice,
        status: "pending",
        isExtraOrder,
        date: serverTimestamp(),
        address: profile?.address || "",
        notified: false,
      });
      alert("Order placed successfully — waiting for owner approval.");
      clearCart();
      setSection("approvedHistory"); // user will see it after approval
    } catch (err) {
      console.error(err);
      alert("Failed to place order.");
    }
  };

  // receipt upload (base64 into Firestore)
  const handleUploadReceipt = async () => {
    if (!receiptFile) return alert("Select an image first!");
    setUploading(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = e.target.result;
      try {
        await updateDoc(doc(db, "users", userID), {
          "plan.paymentSubmitted": true,
          "plan.receiptBase64": base64,
          "plan.receiptName": receiptFile.name,
          "plan.uploadedAt": serverTimestamp(),
        });
        alert("Receipt submitted. Waiting for owner approval.");
        setReceiptFile(null);
      } catch (err) {
        console.error(err);
        alert("Failed to submit receipt.");
      } finally {
        setUploading(false);
      }
    };
    reader.readAsDataURL(receiptFile);
  };

  // Plan Renewal Request
const handleRenewPlan = async () => {
  try {
    const userRef = doc(db, "users", userID);
    await updateDoc(userRef, {
      "plan.paymentSubmitted": true,
      "plan.paid": false,
      "plan.mealsRemaining": 0,
      "plan.startDate": null,
      "plan.endDate": null,
    });
    alert("Plan renewal request sent. Please complete payment.");
    // Redirect to payment page (optional)
    setSection("checkout"); // or window.location.href = "/payment";
  } catch (err) {
    console.error("Renew plan failed:", err);
    alert("Failed to request plan renewal.");
  }
};


  // profile edit
  const handleEditProfile = () => {
    setEditMode(true);
    setFormData({
      name: profile?.name || "",
      email: profile?.email || auth.currentUser?.email || "",
      mobile: profile?.mobile || "",
      address: profile?.address || "",
    });
  };

  const handleSaveProfile = async () => {
    try {
      await updateDoc(doc(db, "users", userID), formData);
      setEditMode(false);
      alert("Profile updated.");
    } catch (err) {
      console.error(err);
      alert("Failed to update profile.");
    }
  };

  // OWNER helpers
  const ownerApprovePlan = async (userDocId) => {
    try {
      const sd = new Date();
      const ed = new Date(sd);
      ed.setDate(ed.getDate() + 30);
      await updateDoc(doc(db, "users", userDocId), {
        "plan.paid": true,
        "plan.paymentSubmitted": false,
        "plan.startDate": sd,
        "plan.endDate": ed,
        "plan.totalMeals": PLAN_CAPACITY,
        "plan.mealsRemaining": PLAN_CAPACITY,
      });
      alert("Plan activated for user.");
    } catch (err) {
      console.error(err);
      alert("Failed to activate plan.");
    }
  };

  const ownerApproveOrder = async (orderId) => {
    try {
      const orderRef = doc(db, "Orders", orderId);
      const orderSnapshot = await getDoc(orderRef);
      if (!orderSnapshot.exists()) return alert("Order not found.");
      const orderData = orderSnapshot.data();
      await updateDoc(orderRef, { status: "approved" });

      // decrement user's mealsRemaining if it's a plan order
      if (!orderData.isExtraOrder) {
        const userRef = doc(db, "users", orderData.userID);
        const userSnapshot = await getDoc(userRef);
        if (userSnapshot.exists()) {
          const user = userSnapshot.data();
          const currRem = user.plan?.mealsRemaining ?? PLAN_CAPACITY;
          const qty = (orderData.items || []).reduce((s, it) => s + (it.quantity || 0), 0);
          const after = Math.max(0, currRem - qty);
          await updateDoc(userRef, { "plan.mealsRemaining": after });
        }
      }
      alert("Order approved.");
    } catch (err) {
      console.error(err);
      alert("Failed to approve order.");
    }
  };


  // styles
  const styles = {
    container: { padding: 20, fontFamily: "Arial, sans-serif", color: "#222" },
    topRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
    btn: { padding: "8px 12px", borderRadius: 6, cursor: "pointer", border: "1px solid #ccc", background: "#fff" },
    smallBtn: { padding: "6px 10px", borderRadius: 6, cursor: "pointer", border: "1px solid #ccc", background: "#fff", fontSize: 13 },
    layout: { display: "flex", gap: 16 },
    left: { flex: 1 },
    right: { width: 360 },
    cardGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 12 },
    card: { border: "1px solid #eee", padding: 12, borderRadius: 8, background: "#fff", boxShadow: "0 2px 6px rgba(0,0,0,0.03)" },
    cartCard: { border: "1px solid #eee", padding: 12, borderRadius: 8, background: "#fff" },
    kpiRow: { display: "flex", gap: 12, marginBottom: 12 },
    kpi: { flex: 1, padding: 12, borderRadius: 8, background: "#fafafa", border: "1px solid #f0f0f0", textAlign: "center" },
  };

  // components
  const Catalog = () => {
    const usedOccMap = itemPlanCounts;
    const usedQtyInPlan = planUsedCount;
    const availablePlanCapacity = Math.max(0, PLAN_CAPACITY - usedQtyInPlan);

    return (
      <div>
        <div style={{ marginBottom: 10 }}>
          <strong>Categories: </strong>
          {[...new Set(MENU.map((m) => m.category))].map((c) => (
            <button key={c} style={{ ...styles.smallBtn, marginRight: 6 }} onClick={() => setSection("catalog-" + c)}>{c}</button>
          ))}
          <button style={{ ...styles.smallBtn, marginLeft: 6 }} onClick={() => setSection("catalog")}>All</button>
        </div>

        <div style={{ marginBottom: 8, color: "#444" }}>
          {planPaid ? (
            <div>Plan capacity remaining: <strong>{availablePlanCapacity}</strong> / {PLAN_CAPACITY}</div>
          ) : <div>Your plan is not active — orders will be treated as Extra until you subscribe.</div>}
        </div>

        <div style={styles.cardGrid}>
          {(section.startsWith("catalog-") ? MENU.filter(m => m.category === section.replace("catalog-", "")) : MENU).map((item) => {
            const inCartQty = cart[item.id] || 0;
            const occ = usedOccMap[item.id] || 0;
            const itemMaxed = planPaid && occ >= PER_ITEM_MAX;
            const planFull = planPaid && availablePlanCapacity <= 0;
            const disableAdd = itemMaxed || planFull;
            return (
              <div key={item.id} style={styles.card}>
                <h4 style={{ margin: "0 0 6px 0" }}>{item.name}</h4>
                <div style={{ fontSize: 13, color: "#666" }}>{item.category} • {item.calories ? `${item.calories} kcal` : ""}</div>
                <div style={{ marginTop: 8 }}>₹{item.price}</div>

                <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
                  <button
                    style={{
                      ...styles.btn,
                      background: disableAdd ? "#ddd" : "#2b8aef",
                      color: disableAdd ? "#666" : "#fff",
                      border: "none",
                    }}
                    onClick={() => addToCart(item.id)}
                    disabled={disableAdd}
                  >
                    {itemMaxed ? "Maxed for plan" : (planFull ? "Plan Full" : "Add")}
                  </button>

                  <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
                    <button onClick={() => removeFromCart(item.id)} style={styles.smallBtn}>-</button>
                    <div>{inCartQty}</div>
                    <button onClick={() => addToCart(item.id)} style={styles.smallBtn}>+</button>
                  </div>
                </div>

                <div style={{ marginTop: 8, fontSize: 12, color: "#555" }}>
                  Per-item order limit per plan: {PER_ITEM_MAX}. ({occ} plan orders include this item)
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const CartBox = () => {
    const items = Object.entries(cart).map(([id, qty]) => {
      const meta = MENU.find(m => m.id === id) || { name: id, price: 0 };
      return { id, name: meta.name, qty, price: meta.price || 0 };
    });
    const totalPrice = items.reduce((s, it) => s + it.qty * it.price, 0);
    return (
      <div style={styles.cartCard}>
        <h4>Cart</h4>
        {items.length === 0 ? <p>No items in cart.</p> : (
          <>
            {items.map(it => (
              <div key={it.id} style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{it.name}</div>
                  <div style={{ fontSize: 13, color: "#666" }}>Qty: {it.qty} • ₹{it.price}</div>
                </div>
                <div>
                  <button onClick={() => setCartQty(it.id, Math.max(0, it.qty - 1))} style={styles.smallBtn}>-</button>
                  <button onClick={() => setCartQty(it.id, Math.min(10, it.qty + 1))} style={styles.smallBtn}>+</button>
                </div>
              </div>
            ))}
            <div style={{ borderTop: "1px solid #eee", paddingTop: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <div><strong>Total</strong></div>
                <div><strong>₹{totalPrice}</strong></div>
              </div>
              <div style={{ marginTop: 8 }}>
                <button onClick={() => setSection("checkout")} style={{ ...styles.btn, background: "#28a745", color: "#fff", border: "none" }}>Checkout</button>{" "}
                <button onClick={() => clearCart()} style={styles.smallBtn}>Clear</button>
              </div>
            </div>
          </>
        )}
      </div>
    );
  };

  const Checkout = () => {
    const items = Object.entries(cart).map(([id, qty]) => {
      const meta = MENU.find((m) => m.id === id) || { name: id, price: 0 };
      return { id, name: meta.name, qty, price: meta.price || 0 };
    });
    const totalQty = items.reduce((s, it) => s + it.qty, 0);
    const totalPrice = items.reduce((s, it) => s + it.qty * it.price, 0);

    return (
      <div>
        <div style={styles.card}>
          <h3>Checkout</h3>
          {items.length === 0 ? <p>No items in cart.</p> : (
            <>
              <div>Items: {items.length}</div>
              <div>Total quantity: {totalQty}</div>
              <div>Total price: ₹{totalPrice}</div>
              <div style={{ marginTop: 8 }}>
                <button onClick={handleCheckout} style={{ ...styles.btn, background: "#2b8aef", color: "#fff", border: "none" }}>Place Order</button>{" "}
                <button onClick={() => setSection("catalog")} style={styles.smallBtn}>Back</button>
              </div>
            </>
          )}
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={styles.card}>
            <h4>Payment / Plan</h4>
            <div>Plan: {planPaid ? "Active ✅" : "Not Active ❌"}</div>
            {(!planPaid) && (
              <div style={{ marginTop: 8 }}>
                <div>Complete your subscription payment</div>
                <input type="file" accept="image/*" onChange={(e) => setReceiptFile(e.target.files[0])} />
                <button onClick={handleUploadReceipt} disabled={uploading} style={{ marginLeft: 8 }}>
                  {uploading ? "Uploading..." : "Submit Receipt"}
                </button>
                {profile?.plan?.paymentSubmitted && <div style={{ color: "#2b8a50", marginTop: 8 }}>Receipt submitted — awaiting approval.</div>}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const ApprovedHistory = () => {
    const approved = orders.filter((o) => o.status === "approved");
    const grouped = approved.reduce((acc, o) => {
      const dt = o.date && o.date.toDate ? o.date.toDate() : (o.date ? new Date(o.date) : new Date());
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
      if (!acc[key]) acc[key] = [];
      acc[key].push(o);
      return acc;
    }, {});
    return (
      <div>
        <h3>Approved Orders</h3>
        {approved.length === 0 && <p>No approved orders yet. When owner approves your order it will appear here.</p>}
        {Object.keys(grouped).map((gk) => (
          <div key={gk} style={{ marginBottom: 10 }}>
            <h4 style={{ margin: "6px 0" }}>{gk}</h4>
            <div style={styles.card}>
              {grouped[gk].map((o) => (
                <div key={o.id} style={{ borderBottom: "1px solid #eee", padding: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <div>
                      <strong>{(o.items || []).map((i) => `${i.name} x${i.quantity}`).join(", ")}</strong>
                      <div style={{ fontSize: 12, color: "#666" }}>{formatDate(o.date)}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div>₹{o.totalPrice}</div>
                      <div style={{ fontSize: 12 }}>{o.status} {o.isExtraOrder ? "(Extra)" : "(Plan)"}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const Account = () => (
    <div style={styles.card}>
      <h3>Account</h3>
      {!editMode ? (
        <>
          <div><strong>{profile?.name}</strong></div>
          <div>{profile?.email}</div>
          <div>{profile?.mobile}</div>
          <div style={{ marginTop: 8 }}>
            <button style={styles.smallBtn} onClick={handleEditProfile}>Edit</button>{" "}
            <button style={styles.smallBtn} onClick={() => { signOut(auth); }}>Logout</button>
          </div>
        </>
      ) : (
        <>
          <input value={formData.name} onChange={(e) => setFormData(p => ({ ...p, name: e.target.value }))} /><br />
          <input value={formData.email} onChange={(e) => setFormData(p => ({ ...p, email: e.target.value }))} /><br />
          <input value={formData.mobile} onChange={(e) => setFormData(p => ({ ...p, mobile: e.target.value }))} /><br />
          <input value={formData.address} onChange={(e) => setFormData(p => ({ ...p, address: e.target.value }))} /><br />
          <button style={styles.smallBtn} onClick={handleSaveProfile}>Save</button>{" "}
          <button style={styles.smallBtn} onClick={() => setEditMode(false)}>Cancel</button>
        </>
      )}
    </div>
  );

  const OwnerPanel = () => {
    if (!isOwner) return null;
    return (
      <div>
        <h3>Owner Panel</h3>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={styles.card}>
              <h4>Users</h4>
              {ownerUsers.map((u) => (
                <div key={u.id} style={{ borderBottom: "1px dashed #eee", padding: 8 }}>
                  <div><strong>{u.name}</strong> ({u.email})</div>
                  <div>Plan: {u.plan?.paid ? "Paid" : "Unpaid"} • Remaining: {u.plan?.mealsRemaining ?? "-"}</div>
                  {u.plan?.paymentSubmitted && (
                    <div style={{ marginTop: 6 }}>
                      {u.plan?.receiptBase64 && <img src={u.plan.receiptBase64} alt="receipt" style={{ maxWidth: 160, display: "block", marginBottom: 6 }} />}
                      <button onClick={() => ownerApprovePlan(u.id)} style={styles.smallBtn}>Approve & Activate</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div style={{ width: 380 }}>
            <div style={styles.card}>
              <h4>Recent Orders</h4>
              {allOrders.slice(0, 30).map((o) => (
                <div key={o.id} style={{ borderBottom: "1px solid #eee", padding: 8 }}>
                  <div><strong>{(o.items || []).map((i) => `${i.name} x${i.quantity}`).join(", ")}</strong></div>
                  <div style={{ fontSize: 12 }}>{formatDate(o.date)} • {o.status} • {o.isExtraOrder ? "Extra" : "Plan"}</div>
                  {o.status !== "approved" && <div style={{ marginTop: 6 }}><button style={styles.smallBtn} onClick={() => ownerApproveOrder(o.id)}>Approve</button></div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // main render
  if (loading) return <div style={{ padding: 20 }}>Loading...</div>;
  if (!profile) return <div style={{ padding: 20 }}>User profile not found.</div>;

  return (
    <div style={styles.container}>
      <div style={styles.topRow}>
        <div>
          <h2 style={{ margin: 0 }}>User Portal</h2>
          <div style={{ fontSize: 13, color: "#444" }}>Welcome, <strong>{profile.name || "User"}</strong> • {profile.email}</div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ textAlign: "right", marginRight: 12 }}>
            <div style={{ fontSize: 13 }}>Orders: <strong>{totalOrders}</strong></div>
            <div style={{ fontSize: 13 }}>Spent: <strong>₹{totalExpense}</strong></div>
          </div>

          <div style={{ display: "flex", gap: 6 }}>
            <button style={styles.smallBtn} onClick={() => setSection("catalog")}>Catalog</button>
            <button style={styles.smallBtn} onClick={() => setSection("checkout")}>Checkout</button>
            <button style={styles.smallBtn} onClick={() => setSection("approvedHistory")}>Approved Orders</button>
            <button style={styles.smallBtn} onClick={() => setSection("account")}>Account</button>
            {isOwner && <button style={styles.smallBtn} onClick={() => setSection("owner")}>Owner</button>}
            <button style={styles.smallBtn} onClick={() => { signOut(auth); }}>Logout</button>
          </div>
        </div>
      </div>

      <div style={styles.kpiRow}>
        <div style={styles.kpi}>
          <div style={{ fontSize: 12 }}>Total Orders</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{totalOrders}</div>
        </div>
        <div style={styles.kpi}>
          <div style={{ fontSize: 12 }}>Total Expense</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>₹{totalExpense}</div>
        </div>
      </div>

      <div style={styles.layout}>
        <div style={styles.left}>
          {section.startsWith("catalog") && <Catalog />}
          {section === "checkout" && <Checkout />}
          {section === "approvedHistory" && <ApprovedHistory />}
          {section === "account" && <Account />}
          {section === "owner" && isOwner && <OwnerPanel />}
        </div>

        <div style={styles.right}>
          <CartBox />
          <div style={{ height: 12 }} />
          <div style={styles.card}>
            <h4>Plan</h4>
            <div>Status: {planPaid ? "Paid ✅" : "Unpaid ❌"}</div>
            <div>Start: {profile?.plan?.startDate ? formatDate(profile.plan.startDate) : "N/A"}</div>
            <div>End: {profile?.plan?.endDate ? formatDate(profile.plan.endDate) : "N/A"}</div>
            <div>Remaining meals: {profile?.plan?.mealsRemaining ?? "-"}</div>

            {!planPaid && (
              <div style={{ marginTop: 8 }}>
                <div><strong>Subscribe / Renew</strong></div>
                <input type="file" accept="image/*" onChange={(e) => setReceiptFile(e.target.files[0])} />
                <button onClick={handleUploadReceipt} disabled={uploading} style={{ marginLeft: 8 }}>
                  {uploading ? "Uploading..." : "Submit Receipt"}
                </button>
                {profile?.plan?.paymentSubmitted && <div style={{ color: "#2b8a50", marginTop: 8 }}>Receipt submitted — waiting approval.</div>}
              </div>
            )}

            {planPaid && (profile?.plan?.mealsRemaining ?? 0) <= 0 && (
  <div style={{ marginTop: 8, color: "#b33" }}>
    <div style={{ marginBottom: 6 }}>
      Plan capacity completed. Please renew the plan to continue ordering.
    </div>
    <button
      onClick={handleRenewPlan}
      style={{
        background: "#007bff",
        color: "#fff",
        border: "none",
        borderRadius: 6,
        padding: "6px 12px",
        cursor: "pointer",
      }}
    >
      Renew Plan
    </button>
  </div>
)}

          </div>
        </div>
      </div>
    </div>
  );
};

export default UserPortal;
