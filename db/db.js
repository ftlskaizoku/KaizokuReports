'use strict';
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, query, where, orderBy, limit, startAfter } = require('firebase/firestore');

let db;

function getDb() {
  if (!db) {
    const firebaseConfig = {
      apiKey: process.env.FIREBASE_API_KEY,
      authDomain: process.env.FIREBASE_AUTH_DOMAIN,
      projectId: process.env.FIREBASE_PROJECT_ID,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.FIREBASE_APP_ID
    };
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
  }
  return db;
}

// Simulate SQL-like query with Firestore
async function query(sql, params = []) {
  const db = getDb();
  if (sql.includes('SELECT * FROM users WHERE')) {
    const usersRef = collection(db, 'users');
    let q = usersRef;
    if (sql.includes('LOWER(email)=') || sql.includes('LOWER(username)=')) {
      const value = params[0];
      q = query(usersRef, where('email', '==', value));
    } else if (sql.includes('id=$1')) {
      const id = params[0];
      const docRef = doc(usersRef, id);
      const docSnap = await getDoc(docRef);
      return { rows: docSnap.exists() ? [{ id: docSnap.id, ...docSnap.data() }] : [] };
    }
    const snapshot = await getDocs(q);
    return { rows: snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) };
  } else if (sql.includes('INSERT INTO users')) {
    const usersRef = collection(db, 'users');
    const data = {
      username: params[0],
      email: params[1],
      password_hash: params[2],
      display_name: params[3],
      role: params[4],
      google_id: params[5] || null,
      onboarding_complete: false,
      status: 'active',
      created_at: new Date()
    };
    const docRef = await addDoc(usersRef, data);
    return { rows: [{ id: docRef.id, ...data }] };
  } else if (sql.includes('UPDATE users SET')) {
    // Simplified update
    const usersRef = collection(db, 'users');
    const id = params[params.length - 1];
    const docRef = doc(usersRef, id);
    const updateData = {};
    // Parse updates from sql string (simplified)
    if (sql.includes('onboarding_complete=true')) {
      updateData.onboarding_complete = true;
    }
    await updateDoc(docRef, updateData);
    return { rows: [{ id }] };
  } else if (sql.includes('SELECT COUNT(*) AS c FROM users')) {
    const usersRef = collection(db, 'users');
    const snapshot = await getDocs(usersRef);
    return { rows: [{ c: snapshot.size }] };
  }
  // Add more as needed
  throw new Error('Unsupported query: ' + sql);
}

async function initDb() {
  // Firestore doesn't need schema creation like SQL; collections are created on write
  // We can add initial data if needed
}

module.exports = { query, initDb };
