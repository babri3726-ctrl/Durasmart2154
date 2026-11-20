import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

export const firebaseConfig = {
  projectId: "durasmart-32cc2",
  appId: "1:683661642672:web:376a7554f92663b6d0a475",
  storageBucket: "durasmart-32cc2.firebasestorage.app",
  apiKey: "AIzaSyAkka7HyPM7OFFKsFlslWyzn0hea8Sg4nI",
  authDomain: "durasmart-32cc2.firebaseapp.com",
  messagingSenderId: "683661642672",
  measurementId: "G-KWC9Z24PN2",
};

export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
