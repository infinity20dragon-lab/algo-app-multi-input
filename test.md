Mac Terminal = Linux Terminal (99% the same)

  | Task             | Linux       | Mac                               |
  |------------------|-------------|-----------------------------------|
  | Open terminal    | Ctrl+Alt+T  | Cmd+Space, type "Terminal", Enter |
  | List files       | ls          | ls                                |
  | Change directory | cd          | cd                                |
  | Install stuff    | apt install | brew install                      |
  | Run node         | node        | node                              |
  | Run npm          | npm run dev | npm run dev                       |

  The only differences:
  - Ctrl → Cmd for shortcuts
  - Package manager is brew instead of apt
  - Finder instead of file manager

  ---
  To open Terminal on Mac:
  1. Press Cmd + Space (opens Spotlight)
  2. Type Terminal
  3. Press Enter

  That's it. Then it's just like Linux!

  ---
  You'll be fine. If you get stuck, I'm here. Want me to write out the exact commands for Mac so you can just copy-paste?

> ok bro.. basically i'll be controlling his mac.. which btw i am using pc keyboard..

● Ah gotcha! PC keyboard on Mac — here's the translation:

  PC → Mac Key Mapping

  | PC Key      | Mac Key           | Common Use         |
  |-------------|-------------------|--------------------|
  | Ctrl        | Cmd (Windows key) | Copy, Paste, etc.  |
  | Alt         | Option            | Special characters |
  | Windows key | Ctrl              | Some shortcuts     |
  | Backspace   | Delete            | Delete text        |

  Shortcuts You'll Need

  | Action                  | PC     | On Mac (with PC keyboard)  |
  |-------------------------|--------|----------------------------|
  | Copy                    | Ctrl+C | Win+C                      |
  | Paste                   | Ctrl+V | Win+V                      |
  | Open Spotlight (search) | -      | Win+Space                  |
  | Open Terminal           | -      | Win+Space, type "Terminal" |
  | New tab in Terminal     | -      | Win+T                      |
  | Cancel command          | Ctrl+C | Ctrl+C (same!)             |

  ---
  Quick cheat sheet:

  Win + Space     → Open Spotlight (search)
  Win + C         → Copy
  Win + V         → Paste
  Ctrl + C        → Cancel running command (same as Linux!)

  ---
  You'll get used to it in 5 minutes. The main thing is Win key = Cmd.

  Ready when you are!

> OK FOR Some fucking reason the only keys not working on my keyboard is the win key

● LOL of course it is. Murphy's law.

  No worries — alternatives:

  Option 1: Use On-Screen Keyboard (on Mac)

  In TeamViewer, there's usually a button to send special keys or open on-screen keyboard.

  Option 2: Remap via TeamViewer

  TeamViewer has a setting: Actions → Send key combinations — it should auto-translate your Ctrl to Cmd.

  Option 3: Just Use Mouse

  On Mac:
  - Spotlight: Click the 🔍 magnifying glass icon (top-right of screen)
  - Copy/Paste: Right-click → Copy/Paste
  - Terminal: Click Spotlight 🔍 → type "Terminal" → click it

  Option 4: Use Ctrl (might work anyway)

  Some apps on Mac accept both Ctrl and Cmd for shortcuts. Try Ctrl+C / Ctrl+V — might just work.

  ---
  Honestly, mouse is fine for this:

  1. Click 🔍 (top-right corner)
  2. Type Terminal
  3. Click it
  4. Type commands normally (keyboard letters work right?)
  5. Right-click to paste

  You got this!

> what abt the installation? since we will be putting this to git

● Right! Here's the full flow for Mac:

  Step 1: Push to GitHub (you do this)

  cd /mnt/g/files/documents/webdev/algo-app
  git add .
  git commit -m "Initial commit"
  git remote add origin https://github.com/YOUR_USERNAME/algo-app.git
  git push -u origin main

  ---
  Step 2: On Boss's Mac (via TeamViewer)

  Check if Git is installed (Mac usually has it):
  git --version

  Install Node.js (if not installed):
  1. Open Safari
  2. Go to https://nodejs.org
  3. Download the Mac installer
  4. Double-click to install
  5. Verify:
  node --version

  Clone and run:
  cd ~/Desktop
  git clone https://github.com/YOUR_USERNAME/algo-app.git
  cd algo-app
  npm install
  npm run dev

  ---
  Then

  Open browser → http://localhost:3000

  ---
  Summary (copy-paste for yourself):
  # On Mac - one-time setup
  cd ~/Desktop
  git clone https://github.com/YOUR_USERNAME/algo-app.git
  cd algo-app
  npm install
  npm run dev

  ---
  Want me to create the GitHub repo and push the code now?

> i push it on git no worries.. since he said he will connect it to mac, means the device right? then we can test it with our app?

● Yes exactly!

  What boss is doing:
  [Mac] ←── same network ──→ [8301] ←──→ [8180G2 Speaker]
                                │
                             [PoE Switch]

  What you'll do:
  1. TeamViewer into his Mac
  2. Clone repo, npm install, npm run dev
  3. Open localhost:3000
  4. Add devices using their local IPs (e.g., 192.168.1.x)
  5. Test playing tones, adjusting volume, etc.

  ---
  Once connected, ask boss for:
  - IP address of the 8301
  - IP address of the 8180G2
  - API password (default is algo)

  Then you can add them in the app and test!

  You're all set. Just let me know when you're in and need help.