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

### মোশন সিস্টেম (কোনো লাইব্রেরি নেই)

- `css/motion.css` — motion tokens (`--dur-*`, `--ease-*`, `--mv` দূরত্ব-গুণক), প্রতিটি সেকশনের আলাদা entrance, কার্ড hover, চ্যাপ্টার page-turn, ফাইনালের রুট, reduced-motion ও mobile টিউনিং
- `js/motion.js` — `window.Motion`: view exit, nav/tab pill, shared-element open (কার্ড ছবি → গল্পের হেডার), journey wipe (CTA), page turn, count-up, dust, card cursor
- `prefers-reduced-motion: reduce` → শুধু opacity, কোনো movement/loop নেই
- Deep link: `#destinations`, `#story/<id>`, `#finale`
- ভোটের পর: বোর্ডিং পাস + স্ট্যাম্প, রুটে ঢাকা → আপনার গন্তব্যে ট্রাভেলার, "দেখা হবে ২৫ ডিসেম্বর" কার্ড (দিন গণনা)
- পাসপোর্ট: কোনো গল্পের ৫টি অধ্যায় পড়লে চ্যাপ্টার বারে স্ট্যাম্প ও ফাইনাল রুটে "পড়া হয়েছে ✓" চিহ্ন (`localStorage` কী `kaz2026.passport`, শুধু এই ডিভাইসে)
- ফাইনাল রুট JS দিয়ে আঁকা হয় (`renderFinaleRoute`), কন্টেইনারের আসল পিক্সেল প্রস্থে
- গল্প: ট্যাব বারের নিচে অধ্যায়-প্রগ্রেস লাইন, "পরবর্তী · <অধ্যায়>" বোতাম, অনুভূতির লাইন একে একে আসে, করব-এর আইকন নিজে আঁকা হয়, হেডারের ছবি স্ক্রলে ধীরে সরে (`animation-timeline: view()`)
- ফাইনাল: ভোট ব্যাজ পুরোনো থেকে নতুন সংখ্যায় গোনে, ফলাফলের বারে "+১" ভাসে
- হিরো: রুট পিলের "?" একটি ডিপারচার বোর্ড (ছয় গন্তব্য ঘুরে আবার "?"), এন্ট্রান্সের পর একবার কাগজের প্লেন উড়ে যায় (ডেস্কটপ), গ্লো ব্রিদিং, পয়েন্টার প্যারালাক্স (`Motion.departureBoard/heroFlight/heroParallax`)

- লাইভ কাউন্ট JavaScript দিয়ে `votes` কালেকশন থেকে হিসাব  
- Change / Undo একই `votes/{uid}` ডকুমেন্ট আপডেট/ডিলিট  
- Anonymous Auth UID = voter id (ভোট কাউন্ট localStorage-এ নয়)  
- `onSnapshot` দিয়ে অন্য ডিভাইসে লাইভ আপডেট  

## ৬টি পছন্দ

1. সুন্দরবন  
2. সিলেট + শ্রীমঙ্গল  
3. সাজেক + কাপ্তাই  
4. নেপাল  
5. বান্দরবান  
6. কক্সবাজার এবং সেন্টমার্টিন  

## নোট

- ভোট Firebase Firestore-এ সংরক্ষিত হয়  
- Vercel স্ট্যাটিক হোস্টিং-এ সরাসরি কাজ করে  
