// src/OwnerPortal.js
import React, { useEffect, useMemo, useState } from "react";
import { auth, db } from "./firebase";
import { signOut } from "firebase/auth";
import {
  collection,
  doc,
  onSnapshot,
  updateDoc,
  getDoc,
  serverTimestamp,
  query,
  orderBy,
} from "firebase/firestore";

/**
 * OwnerPortal.js
 * - Grid dashboard of approved customers (cards)
 * - Payments tab (approve receipts -> activate plan)
 * - Orders tab (pending / approved, approve order -> decrement plan mealsRemaining)
 * - All real-time via Firestore
 *
 * Assumptions:
 * - Users stored in 'users' collection
 * - Orders stored in 'Orders' collection
 * - Receipt is stored on user doc at user.plan.receiptBase64 or user.paymentScreenshot
 * - Approving a payment will set plan.paid = true, plan.startDate, plan.endDate (+30 days),
 *   plan.mealsRemaining = 30, and clear plan.paymentSubmitted
 */

function formatDate(ts) {
  if (!ts) return "N/A";
  try {
    if (ts.toDate) return ts.toDate().toLocaleDateString();
    return new Date(ts).toLocaleDateString();
  } catch {
    return "N/A";
  }
}

const OwnerPortal = () => {
  const [users, setUsers] = useState([]);
  const [orders, setOrders] = useState([]);
  const [section, setSection] = useState("dashboard"); // dashboard | orders | payments
  const [loading, setLoading] = useState(true);

  // real-time users
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "users"), (snap) => {
      const arr = [];
      snap.forEach((ds) => arr.push({ id: ds.id, ...ds.data() }));
      setUsers(arr);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // real-time orders (sorted by date desc)
  useEffect(() => {
    const q = query(collection(db, "Orders"), orderBy("date", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      const arr = [];
      snap.forEach((ds) => arr.push({ id: ds.id, ...ds.data() }));
      setOrders(arr);
    });
    return () => unsub();
  }, []);

  // logout
  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error("Logout failed", err);
    }
  };

  // download base64 image helper
  const downloadBase64Image = (base64, filename = "receipt.png") => {
    const link = document.createElement("a");
    link.href = base64;
    link.download = filename;
    link.click();
  };

  // Approve payment: activate the user's plan
  const approvePayment = async (user) => {
    try {
      const userRef = doc(db, "users", user.id);
      const start = new Date();
      const end = new Date(start);
      end.setDate(end.getDate() + 30);
      await updateDoc(userRef, {
        "plan.paid": true,
        "plan.paymentSubmitted": false,
        "plan.receiptBase64": user.plan?.receiptBase64 || null,
        "plan.receiptName": user.plan?.receiptName || null,
        "plan.startDate": start,
        "plan.endDate": end,
        "plan.totalMeals": 30,
        "plan.mealsRemaining": 30,
        "plan.paymentApprovedAt": serverTimestamp(),
        paymentStatus: "approved", // optional field
      });
      alert("✅ Payment approved and plan activated.");
    } catch (err) {
      console.error(err);
      alert("❌ Payment approval failed.");
    }
  };

  // Approve single order
  const approveOrder = async (order) => {
    try {
      const orderRef = doc(db, "Orders", order.id);
      await updateDoc(orderRef, {
        status: "approved",
        approvedAt: serverTimestamp(),
      });

      // If it's a plan order, decrement user's mealsRemaining
      if (!order.isExtraOrder && order.userID) {
        const userRef = doc(db, "users", order.userID);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          const userData = userSnap.data();
          const currRem = Number(userData?.plan?.mealsRemaining ?? 30);
          // compute total qty in order
          const qty = (order.items || []).reduce((s, it) => s + (it.quantity || 0), 0);
          const after = Math.max(0, currRem - qty);
          await updateDoc(userRef, { "plan.mealsRemaining": after });
        }
      }

      alert("✅ Order approved.");
    } catch (err) {
      console.error("Approve order failed", err);
      alert("❌ Approve order failed.");
    }
  };

  // Derived metrics per user for dashboard (memoized)
  const userStats = useMemo(() => {
    // Build map of orders by user
    const map = {};
    users.forEach((u) => {
      map[u.id] = {
        user: u,
        orders: [],
        approvedOrders: [],
        pendingOrders: [],
        totalSpent: 0,
        approvedCount: 0,
        pendingCount: 0,
        planUsedMeals: 0,
      };
    });

    orders.forEach((o) => {
      const uid = o.userID;
      if (!map[uid]) {
        // user may not exist in users snapshot yet
        map[uid] = {
          user: null,
          orders: [],
          approvedOrders: [],
          pendingOrders: [],
          totalSpent: 0,
          approvedCount: 0,
          pendingCount: 0,
          planUsedMeals: 0,
        };
      }
      map[uid].orders.push(o);
      map[uid].totalSpent += Number(o.totalPrice || 0);
      if (o.status === "approved") {
        map[uid].approvedOrders.push(o);
        map[uid].approvedCount += 1;
        if (!o.isExtraOrder) {
          map[uid].planUsedMeals += (o.items || []).reduce((s, it) => s + (it.quantity || 0), 0);
        }
      } else {
        map[uid].pendingOrders.push(o);
        map[uid].pendingCount += 1;
        // pending plan orders are also considered for capacity preview (not deducted until approved)
        if (!o.isExtraOrder) {
          map[uid].planUsedMeals += (o.items || []).reduce((s, it) => s + (it.quantity || 0), 0);
        }
      }
    });

    return map; // { userId: stats }
  }, [users, orders]);

  // Useful lists
  const pendingPayments = users.filter((u) => u?.plan?.paymentSubmitted || u.paymentStatus === "pending");
  const approvedUsers = users.filter((u) => u?.plan?.paid || u.paymentStatus === "approved");

  // Small helper to compute plan utilization %
  const calcPlanPercent = (u) => {
    const total = Number(u?.plan?.totalMeals ?? 30);
    const remaining = Number(u?.plan?.mealsRemaining ?? 0);
    const used = Math.max(0, total - remaining);
    const pct = total > 0 ? Math.round((used / total) * 100) : 0;
    return { used, total, pct, remaining };
  };

  // Styles
  const styles = {
    page: { padding: 20, fontFamily: "Arial, sans-serif" },
    nav: { marginBottom: 14, display: "flex", gap: 8 },
    btn: { padding: "8px 12px", borderRadius: 6, cursor: "pointer", border: "1px solid #ccc", background: "#fff" },
    containerGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 },
    userCard: { border: "1px solid #eee", padding: 12, borderRadius: 8, background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" },
    small: { fontSize: 13, color: "#555" },
    ordersCol: { display: "flex", gap: 12 },
    orderCard: { border: "1px solid #eee", padding: 10, borderRadius: 6, marginBottom: 8, background: "#fff" },
    receiptImg: { maxWidth: 240, borderRadius: 6, border: "1px solid #ddd", marginTop: 8 },
    statsRow: { display: "flex", gap: 8, marginTop: 8, alignItems: "center" },
    progressOuter: { height: 12, background: "#eee", borderRadius: 8, overflow: "hidden", flex: 1 },
    progressInner: { height: "100%", background: "#28a745" },
  };

  // Render: Dashboard grid of approved customers (cards)
  const Dashboard = () => {
    return (
      <div>
        <div style={{ marginBottom: 12 }}>
          <strong>Approved Customers</strong> — {approvedUsers.length}
        </div>

        {approvedUsers.length === 0 ? (
          <div style={styles.userCard}>No approved customers yet.</div>
        ) : (
          <div style={styles.containerGrid}>
            {approvedUsers.map((u) => {
              const stats = userStats[u.id] || { totalSpent: 0, approvedCount: 0, pendingCount: 0, planUsedMeals: 0 };
              const plan = u.plan || {};
              const { used, total, pct, remaining } = calcPlanPercent(u);
              // status label
              const now = new Date();
              const endDate = plan.endDate ? (plan.endDate?.toDate ? plan.endDate.toDate() : new Date(plan.endDate)) : null;
              const startDate = plan.startDate ? (plan.startDate?.toDate ? plan.startDate.toDate() : new Date(plan.startDate)) : null;
              let statusLabel = "Unknown";
              if (plan.paid && endDate) {
                statusLabel = endDate >= now ? "Active" : "Expired";
              } else {
                statusLabel = plan.paymentSubmitted ? "Payment submitted" : "No plan";
              }

              return (
                <div key={u.id} style={styles.userCard}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 700 }}>{u.name || "—"}</div>
                      <div style={{ ...styles.small }}>{u.email || "—"}</div>
                      <div style={{ ...styles.small }}>{u.mobile || "—"}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{statusLabel}</div>
                    </div>
                  </div>

                  <div style={{ marginTop: 10 }}>
                    <div style={styles.small}><b>Plan:</b> {plan.paid ? "Paid" : "Unpaid"}</div>
                    <div style={styles.small}><b>Start:</b> {plan.startDate ? formatDate(plan.startDate) : "—"}</div>
                    <div style={styles.small}><b>End:</b> {plan.endDate ? formatDate(plan.endDate) : "—"}</div>
                  </div>

                  <div style={{ marginTop: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 80, fontWeight: 700 }}>{used}/{total}</div>
                      <div style={styles.progressOuter}>
                        <div style={{ ...styles.progressInner, width: `${Math.min(100, pct)}%` }} />
                      </div>
                      <div style={{ width: 40, textAlign: "right", fontWeight: 700 }}>{pct}%</div>
                    </div>
                    <div style={{ marginTop: 8, ...styles.small }}>
                      <div>Approved Orders: {stats.approvedCount} • Pending: {stats.pendingCount}</div>
                      <div>Total Spent: ₹{Math.round(stats.totalSpent)}</div>
                      <div>Meals Remaining: {plan.mealsRemaining ?? "-"}</div>
                    </div>
                  </div>

                  <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                    {/* quick actions */}
                    <button
                      style={styles.btn}
                      onClick={() => {
                        // open user's order list (navigate to orders tab and filter)
                        setSection("orders");
                        // small UX: scroll to user's orders by setting window location or you can add state for filter
                        // We'll set a sessionStorage key so Orders tab can pick it up
                        sessionStorage.setItem("owner_view_user", u.id);
                      }}
                    >
                      View Orders
                    </button>

                    {u.plan?.paymentSubmitted && (
                      <button style={styles.btn} onClick={() => approvePayment(u)}>Approve Payment</button>
                    )}

                    <button
                      style={styles.btn}
                      onClick={() => {
                        // manual renew: set paymentSubmitted true to prompt renew (owner can then confirm/activate)
                        const userRef = doc(db, "users", u.id);
                        updateDoc(userRef, { "plan.paymentSubmitted": true }).then(() => {
                          alert("Renew flag set — user should upload receipt or you can approve manually.");
                        }).catch((e) => {
                          console.error(e);
                          alert("Failed to set renew flag.");
                        });
                      }}
                    >
                      Mark for Renew
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // PaymentRequests component
  const PaymentRequests = () => {
    if (pendingPayments.length === 0) return <div style={styles.card}>No pending payment requests.</div>;
    return (
      <div>
        <h3>Pending Payment Requests</h3>
        <div style={styles.containerGrid}>
          {pendingPayments.map((u) => (
            <div key={u.id} style={styles.userCard}>
              <div style={{ fontWeight: 700 }}>{u.name || "—"}</div>
              <div style={styles.small}>{u.email}</div>
              <div style={{ marginTop: 8 }}>
                <div style={styles.small}><b>Plan Price:</b> ₹{u.plan?.price || 1200}</div>
                {u.plan?.receiptBase64 ? (
                  <>
                    <img src={u.plan.receiptBase64} alt="receipt" style={styles.receiptImg} />
                    <div style={{ marginTop: 6 }}>
                      <button style={styles.btn} onClick={() => downloadBase64Image(u.plan.receiptBase64, `${u.name || "receipt"}-receipt.png`)}>Download</button>{" "}
                      <button style={styles.btn} onClick={() => approvePayment(u)}>Approve Payment</button>
                    </div>
                  </>
                ) : u.paymentScreenshot ? (
                  <>
                    <img src={u.paymentScreenshot} alt="receipt" style={styles.receiptImg} />
                    <div style={{ marginTop: 6 }}>
                      <button style={styles.btn} onClick={() => downloadBase64Image(u.paymentScreenshot, `${u.name || "receipt"}-receipt.png`)}>Download</button>{" "}
                      <button style={styles.btn} onClick={() => approvePayment(u)}>Approve Payment</button>
                    </div>
                  </>
                ) : (
                  <div style={{ marginTop: 6 }}>No receipt uploaded.</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // Orders tab - show pending and approved lists; allow approve
  const OrdersTab = () => {
    // optional filter if owner clicked from a user card
    const filterUser = sessionStorage.getItem("owner_view_user") || null;

    const pending = orders.filter((o) => o.status !== "approved" && (!filterUser || o.userID === filterUser));
    const approved = orders.filter((o) => o.status === "approved" && (!filterUser || o.userID === filterUser));

    return (

      
      <div>
        <div style={{ marginBottom: 12 }}>
          <strong>Orders</strong> {filterUser && <span style={{ marginLeft: 8 }}>• Showing for user: {filterUser}</span>}
          {filterUser && <button style={{ marginLeft: 8 }} onClick={() => sessionStorage.removeItem("owner_view_user")}>Clear filter</button>}
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <h4>Pending Orders</h4>
            {pending.length === 0 && <div style={styles.orderCard}>No pending orders.</div>}
            {pending.map((o) => {
              const user = users.find((u) => u.id === o.userID);
              return (
                <div key={o.id} style={styles.orderCard}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <div>
                      <strong>{user?.name || "Unknown"}</strong>
                      <div style={styles.small}>{user?.email}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontWeight: 700 }}>₹{o.totalPrice}</div>
                      <div style={{ fontSize: 12 }}>{o.isExtraOrder ? "Extra" : "Plan"}</div>
                    </div>
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <div style={styles.small}><b>Items:</b> {(o.items || []).map(i => `${i.name} x${i.quantity}`).join(", ")}</div>
                    <div style={styles.small}><b>Date:</b> {formatDate(o.date)}</div>
                    <div style={{ marginTop: 8 }}>
                      <button style={styles.btn} onClick={() => approveOrder(o)}>Approve Order</button>{" "}
                      <button style={styles.btn} onClick={async () => {
                        // reject/cancel: set status cancelled
                        try {
                          await updateDoc(doc(db, "Orders", o.id), { status: "cancelled" });
                          alert("Order cancelled.");
                        } catch (err) {
                          console.error(err);
                          alert("Failed to cancel.");
                        }
                      }}>Cancel</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ width: 380 }}>
            <h4>Approved Orders</h4>
            {approved.length === 0 && <div style={styles.orderCard}>No approved orders yet.</div>}
            {approved.map((o) => {
              const user = users.find((u) => u.id === o.userID);
              return (
                <div key={o.id} style={styles.orderCard}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <div>
                      <strong>{user?.name || "Unknown"}</strong>
                      <div style={styles.small}>{user?.email}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontWeight: 700 }}>₹{o.totalPrice}</div>
                      <div style={{ fontSize: 12 }}>{o.isExtraOrder ? "Extra" : "Plan"}</div>
                    </div>
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <div style={styles.small}><b>Items:</b> {(o.items || []).map(i => `${i.name} x${i.quantity}`).join(", ")}</div>
                    <div style={styles.small}><b>Date:</b> {formatDate(o.date)}</div>
                    <div style={{ marginTop: 8, fontSize: 12, color: "#666" }}>Approved</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  // Dashboard summary (top overview)
  const DashboardSummary = () => {
    const totalUsers = users.length;
    const totalOrders = orders.length;
    const totalSales = orders.reduce((s, o) => s + Number(o.totalPrice || 0), 0);
    const approvedPaymentsCount = users.filter(u => u.plan?.paid || u.paymentStatus === "approved").length;
    return (
      <div style={styles.card}>
        <h3>Dashboard Overview</h3>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div><b>Total Users</b></div>
            <div style={styles.small}>{totalUsers}</div>
          </div>
          <div style={{ flex: 1 }}>
            <div><b>Approved Payments</b></div>
            <div style={styles.small}>{approvedPaymentsCount}</div>
          </div>
          <div style={{ flex: 1 }}>
            <div><b>Total Orders</b></div>
            <div style={styles.small}>{totalOrders}</div>
          </div>
          <div style={{ flex: 1 }}>
            <div><b>Sales</b></div>
            <div style={styles.small}>₹{Math.round(totalSales)}</div>
          </div>
        </div>
      </div>
    );
  };

  if (loading) return <div style={{ padding: 20 }}>Loading...</div>;

  return (
    <div style={styles.page}>
      <h2>Owner Portal</h2>
      <div style={styles.nav}>
        <button style={styles.btn} onClick={() => setSection("dashboard")}>Dashboard</button>
        <button style={styles.btn} onClick={() => setSection("orders")}>Orders</button>
        <button style={styles.btn} onClick={() => setSection("payments")}>Payments</button>
        <button style={styles.btn} onClick={handleLogout}>Logout</button>
      </div>

      <DashboardSummary />

      {section === "dashboard" && <Dashboard />}
      {section === "payments" && <PaymentRequests />}
      {section === "orders" && <OrdersTab />}
    </div>
  );
};

export default OwnerPortal;
