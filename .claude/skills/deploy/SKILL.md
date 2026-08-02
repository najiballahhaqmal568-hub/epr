---
name: deploy
description: Ship a change of the Shoe Shop ERP to the owner — build, run the accounting tests, commit, push, build and sign the Android APK, publish the web app and APK to gh-pages, verify the live bundle, and send the APK. Use whenever the user asks to deploy, publish, release, "لینک اپ", or wants a new APK.
---

# Deploying the Shoe Shop ERP

The owner installs the APK on a phone and opens the web app from
`https://najiballahhaqmal568-hub.github.io/epr/`. A deploy is not finished until
**both** are updated and the live bundle hash has been verified — the browser
caches aggressively, so "it built fine" is not evidence the owner will see it.

Run these steps in order. Do not skip verification even for a one-line change.

## 0. Know what you are shipping

```bash
git status --short
git log --oneline -3
```

Anything unexpected in `git status` gets resolved before continuing. Never
`git clean -fd` here — it deletes `node_modules`.

## 1. Build and test — both must pass

```bash
npm run build
npm test
```

`npm run build` must end with `✓ built`, with no `error TS`.
`npm test` must end with `✅ همه درست` — if any scenario fails, stop and fix it.
A failing accounting test means the owner's numbers would be wrong.

If the change touched UI, also drive it in a real browser before shipping:

```bash
nohup npx vite preview --port 4173 >/tmp/prev.log 2>&1 & disown
until curl -sf -o /dev/null http://localhost:4173/; do sleep 1; done
node tests/<your>-e2e.mjs
```

Copy `tests/merge-e2e.mjs` as the pattern. Preview serves at `/`, not `/epr/`
(vite `base` is `./`). Do not use `pkill -f "vite preview"` — it kills the shell.

## 2. Commit and push

Commit message in Dari, describing what changed for the shop — not the
implementation.

```bash
git add -A
git commit -q -m "<پیام دری>"
git push -q origin main:main
git branch -f claude/shoe-erp-mobile-app-wb82ej main
git push -q origin claude/shoe-erp-mobile-app-wb82ej
```

The development branch is kept identical to `main`. Do not open a pull request
unless the user asks for one.

## 3. Build and sign the APK

```bash
npx cap sync android >/dev/null 2>&1
cd android && ANDROID_HOME=/opt/android-sdk /opt/gradle/bin/gradle assembleRelease -q >/dev/null 2>&1

BT=/opt/android-sdk/build-tools/35.0.0     # glob the dir and you get two matches
SP=<your scratchpad dir>
$BT/zipalign -f 4 /home/user/epr/android/app/build/outputs/apk/release/app-release-unsigned.apk $SP/shoe-erp.apk
$BT/apksigner sign --ks /home/user/epr/android/shoeerp.keystore \
  --ks-pass "pass:$KS_PASS" --key-pass "pass:$KS_PASS" $SP/shoe-erp.apk
```

Signing with the same keystore every time is what lets the owner install over
the previous version instead of uninstalling first. Never generate a new one.

**The keystore password is a secret and must never be written into this repo —
it is public.** Ask the user for it, or read it from an untracked file, and pass
it through an environment variable as above. If you find it committed anywhere,
say so and remove it.

## 4. Publish web + APK from a fresh clone

`gh-pages` holds the built `dist` plus `shoe-erp.apk`, and has its own
`.gitignore`. Always deploy from a throwaway clone — never by checking out the
branch in the working tree.

```bash
rm -rf /tmp/ghd
git clone -q --branch gh-pages --depth 1 "$(git -C /home/user/epr remote get-url origin)" /tmp/ghd
cd /tmp/ghd
find . -mindepth 1 -maxdepth 1 ! -name .git ! -name .gitignore -exec rm -rf {} +
cp -r /home/user/epr/dist/* .
cp $SP/shoe-erp.apk .
touch .nojekyll
git add -A && git commit -q -m "deploy: <what changed>" && git push -q origin gh-pages
grep -o 'index-[A-Za-z0-9_-]*\.js' index.html | head -1
```

Note the bundle hash it prints — the next step needs it.

## 5. Verify the owner will actually get it

GitHub Pages takes a minute or two. Poll until the new hash is live:

```bash
until curl -s https://najiballahhaqmal568-hub.github.io/epr/ | grep -q '<hash from step 4>'; do sleep 10; done; echo LIVE
```

Do not report success before this returns. Use `dangerouslyDisableSandbox: true`
for this call (outbound network), and an `until` loop rather than a bare `sleep`.

## 6. Send the APK and explain in Dari

Send `$SP/shoe-erp.apk` with `SendUserFile`, then summarise in Dari:

- what changed, in shop language and with the owner's own example numbers
- where in the app to find it (tab ← button)
- what is guaranteed not to have changed (totals, existing records)
- the test count, e.g. `۲۹۶ بررسی در ۴۳ سناریو ✅`

Keep it short. The owner cares whether the numbers are right and where to tap —
not how it was implemented.
