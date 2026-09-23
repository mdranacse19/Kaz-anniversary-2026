# KAZ Software অ্যানিভার্সারি ট্যুর ২০২৬

স্ট্যাটিক সাইট + **Firebase Firestore** ভোট (Vercel-friendly, Node সার্ভার লাগে না)।

## চালানো

লোকালে যেকোনো স্ট্যাটিক সার্ভার:

```bash
cd "/home/mdranacse19/Downloads/Anniversary Tour 2026"
python3 -m http.server 8765
```

→ http://127.0.0.1:8765  

বা সরাসরি Vercel-এ ডিপ্লয় করুন।

## Firebase সেটআপ (একবার)

প্রজেক্ট: `kaz-software-8007a`

1. Open: https://console.firebase.google.com/project/kaz-software-8007a/authentication  
2. **Get started** চাপুন (Authentication প্রোডাক্ট অন করতে)  
3. **Sign-in method → Anonymous → Enable → Save**  
4. Firestore আছে কি নিশ্চিত করুন: Build → Firestore Database  
5. **Firestore → Rules** ট্যাবে `firestore.rules` এর কন্টেন্ট পেস্ট করে **Publish**  
6. Soft/hard refresh the site  

`auth/configuration-not-found` = Authentication এখনো Get started করা হয়নি (শুধু Anonymous টগল নয়)।

সাইট Anonymous Auth ছাড়াও fallback দিয়ে ভোট চালাতে পারে, কিন্তু Firestore rules অবশ্যই Publish করতে হবে।

## আর্কিটেকচার

`Browser JS → Firebase Firestore → shared votes`

- লাইভ কাউন্ট JavaScript দিয়ে `votes` কালেকশন থেকে হিসাব  
- Change / Undo একই `votes/{uid}` ডকুমেন্ট আপডেট/ডিলিট  
- Anonymous Auth UID = voter id (ভোট কাউন্ট localStorage-এ নয়)  
- `onSnapshot` দিয়ে অন্য ডিভাইসে লাইভ আপডেট  

## ৬টি পছন্দ

1. সুন্দরবন  
2. সিলেট + শ্রীমঙ্গল  
3. রাঙ্গামাটি  
4. সাজেক + রাঙ্গামাটি  
5. নেপাল  
6. বান্দরবান  

## নোট

- ভোট Firebase Firestore-এ সংরক্ষিত হয়  
- Vercel স্ট্যাটিক হোস্টিং-এ সরাসরি কাজ করে  
