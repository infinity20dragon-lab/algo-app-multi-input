# Admin Role Setup Guide

## How Admin Roles Work

The app now uses a `users` collection in Firestore to store user roles:

```
/users
  /{uid}
    email: "user@example.com"
    displayName: "User"
    role: "user" | "admin"
    createdAt: Date
    lastLogin: Date
```

## Setting Up Your First Admin

### Step 1: Login First
1. Start the app
2. Login with your account
3. This creates your user profile with role: "user"

### Step 2: Make Yourself Admin
1. Go to Firebase Console → Firestore
2. Find the `users` collection
3. Click on your user document (UID)
4. Find the `role` field
5. Change value from `"user"` to `"admin"`
6. Save

### Step 3: Logout & Login Again
1. Logout from the app
2. Login again
3. You're now an admin!

---

## Verifying Admin Access

Once you're admin, you should see:

✅ **"Control Center"** link in sidebar
✅ Can access `/admin/control` page
✅ Can control other users' sessions
✅ Crown emoji (👑) next to your cursor

---

## Making More Admins

To make another user admin:

1. They must login first (creates their user profile)
2. Go to Firestore → `users` collection
3. Find their UID
4. Change `role` to `"admin"`
5. They logout & login again

---

## Security Rules for Users Collection

Add this to your Firestore rules:

```javascript
match /users/{userId} {
  // Anyone can read user profiles (needed for presence/cursors)
  allow read: if request.auth != null;

  // Users can only write to their own profile (except role)
  allow create: if request.auth.uid == userId;
  allow update: if request.auth.uid == userId &&
                !request.resource.data.diff(resource.data).affectedKeys().hasAny(['role']);

  // Only admins can update roles (you'll need to implement admin check)
  // For now, you can only change roles manually in Firebase Console
}
```

---

## Default Behavior

- **New users**: Automatically get `role: "user"`
- **First login**: Creates user profile in Firestore
- **Every login**: Updates `lastLogin` timestamp
- **Profile auto-created**: No manual setup needed (except for admin promotion)

---

## Testing Multi-User Roles

### Test User A (Regular User):
1. Login as `usera@example.com`
2. Should NOT see "Control Center" in sidebar
3. Cannot access `/admin/control` (redirected)

### Test Admin:
1. Login as your admin account
2. Should see "Control Center" in sidebar
3. Can access `/admin/control`
4. Can see User A in online users list
5. Can control User A's session

---

## Troubleshooting

### "Control Center" not showing
- Check Firestore: Is `role` = `"admin"`?
- Logout and login again
- Check browser console for errors

### Can't access Control Center
- Make sure you're logged in as admin
- Clear browser cache
- Check Firebase Console for user profile

### Role not updating
- Must logout & login after changing role
- Role is fetched fresh on every login

---

## Quick Admin Checklist

- [ ] Login to create your user profile
- [ ] Go to Firestore → users → your UID
- [ ] Change `role` to `"admin"`
- [ ] Logout
- [ ] Login
- [ ] Verify "Control Center" appears in sidebar
- [ ] Test accessing `/admin/control`

Done! 🎉
