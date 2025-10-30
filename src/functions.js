import { db } from "./firebase";
import { collection, addDoc, updateDoc, doc, getDoc } from "firebase/firestore";

// Calculate total price
export const calculatePrice = (items, isExtra) => {
  let price = 0;
  items.forEach(item => {
    price += (item.name === "Healthy Meal" ? 40 : 10) * item.quantity;
  });
  if(isExtra) price *= 1.2;
  return price;
};

// Place Order
export const placeOrder = async (userID, items, isExtra) => {
  const orderRef = collection(db, "Orders");
  const orderData = {
    userID,
    items,
    totalPrice: calculatePrice(items, isExtra),
    date: new Date(),
    status: "pending",
    isExtraOrder: isExtra
  };
  await addDoc(orderRef, orderData);
};

// Approve Order (Owner)
export const approveOrder = async (orderID, userID, items) => {
  const orderDoc = doc(db, "Orders", orderID);
  await updateDoc(orderDoc, { status: "approved" });

  const userDoc = doc(db, "Users", userID);
  const userSnap = await getDoc(userDoc);
  const userData = userSnap.data();

  items.forEach(item => {
    if(item.name === "Healthy Meal") userData.plan.mealsRemaining -= item.quantity;
    if(item.name === "Chai") userData.plan.chaiRemaining -= item.quantity;
  });

  await updateDoc(userDoc, { plan: userData.plan });
};
