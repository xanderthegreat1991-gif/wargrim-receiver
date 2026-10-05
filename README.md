# Wargrim 3000 - TV receiver (Stage 2)

A static web page that the Chromecast / Google TV loads while you cast from the phone app.
No build step. Files: index.html, receiver.css, receiver.js, themes.js, img/ (the dwarf layers).

## Try it in any browser (no TV needed)
Open index.html with these options added after the file name:
  ?demo=1&theme=metal            (theme ids: classic metal punk synthwave jazz hiphop country classical lofi electronic reggae)
  &lyrics=0   no lyrics          &dwarf=0   no dwarf          &reduce=1   no effects          &mood=happy|angry

## Host it (free, must be https)
GitHub Pages: make a new PUBLIC repository (for example "wargrim-receiver"), upload everything in this folder
(keep the img folder), then Settings > Pages > Deploy from branch "main" / root.
The address will be https://<your-github-name>.github.io/wargrim-receiver/ (the folder contains only the page, no private data).

## Register it with Google ($5 once)
1. Go to the Google Cast SDK Developer Console, sign in, pay the $5 registration.
2. Add New Application > Custom Receiver. Name: Wargrim 3000. Receiver URL: the https address above.
3. Copy the Application ID (8 letters/numbers) it shows you.
4. Add Device: enter your TV/Chromecast serial number (cast the console page to it to read the serial), wait about 15 minutes, then
   unplug and re-plug the Chromecast (or restart the TV).
5. Put the Application ID into the app (one constant in the Cast code) and rebuild.
An unpublished receiver only works on devices you registered, which is all a personal app needs.

## Messages from the phone (namespace urn:x-cast:com.wargrim.player, JSON)
 {type:'theme', id:'metal', colors:{bg,surface,text,dim,accent,accent2}, reduce:false, dwarf:true}
 {type:'lyrics', key:'<same as the item customData.key>', synced:true, lines:[{t:12.5,text:'...'}]}   // synced
 {type:'lyrics', key:'...', synced:false, lines:[{text:'...'}]}                                        // plain text
 {type:'lyrics', key:'...', lines:[]}                                                                  // none
 {type:'mood', mood:'happy'|'angry'}      // the dwarf reacts for about 3 seconds
 {type:'settings', lyrics:true, dwarf:true, reduce:false}
Title, artist, album and artwork come from the normal Cast media info (metadata + images).
Send customData:{key:<track key>} with every loaded item so the lyrics find their song.
