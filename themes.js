// Theme table for the TV page. The phone can send a theme id (matching the app's theme ids)
// and, optionally, explicit colours that override these values.
// hue = degrees of hue-rotate applied to the teal headphones/glow (teal is ~170deg).
window.WG_THEMES = {
  classic:    {name:'Classic Wargrim', bg:'#0d1218', surface:'#17202a', text:'#e9f0f5', dim:'#8ea0b0', accent:'#2ee6c8', title:'Oswald',            body:'Oswald',            fx:'none',      hue:0,    acc:[]},
  metal:      {name:'Metal',      bg:'#0b0708', surface:'#1a1011', text:'#efe6e2', dim:'#9c8a86', accent:'#e0302a', title:'Pirata One',         body:'Oswald',            fx:'embers',    hue:-166, acc:['spikes','redeyes']},
  punk:       {name:'Punk',       bg:'#101010', surface:'#1d1d1d', text:'#f4f1e6', dim:'#a9a596', accent:'#ff2e88', title:'Special Elite',      body:'Special Elite',     fx:'sparks',    hue:160,  acc:['headband']},
  synthwave:  {name:'Synthwave',  bg:'#14052e', surface:'#24093f', text:'#fbeaff', dim:'#b79ad6', accent:'#2ee6ff', accent2:'#ff4fd8', title:'Orbitron', body:'Exo 2', fx:'grid', hue:25, acc:['sunglasses']},
  jazz:       {name:'Jazz',       bg:'#1a110b', surface:'#2a1b12', text:'#f3e6d0', dim:'#a8937a', accent:'#d9a441', title:'Playfair Display',   body:'Playfair Display',  fx:'smoke',     hue:-130, acc:[]},
  hiphop:     {name:'Hip-hop',    bg:'#090909', surface:'#161616', text:'#f4efe2', dim:'#a8a08a', accent:'#f2c230', title:'Anton',              body:'Oswald',            fx:'none',      hue:-125, acc:['crown']},
  country:    {name:'Country',    bg:'#25180d', surface:'#3a2616', text:'#f4e6cf', dim:'#b49c7c', accent:'#5b86bd', title:'Zilla Slab',         body:'Zilla Slab',        fx:'dust',      hue:45,   acc:['cowboy']},
  classical:  {name:'Classical',  bg:'#f3eee1', surface:'#e7dfcb', text:'#1b2440', dim:'#5d6785', accent:'#1b2440', title:'Cormorant Garamond', body:'Cormorant Garamond', fx:'notes',    hue:55,   acc:[], light:true},
  lofi:       {name:'Lo-fi',      bg:'#1b1a29', surface:'#272539', text:'#e8e8f4', dim:'#9a9bb8', accent:'#9fb4e8', title:'Quicksand',          body:'Quicksand',         fx:'rain',      hue:55,   acc:['beanie']},
  electronic: {name:'Electronic', bg:'#000000', surface:'#0a1411', text:'#e6fff4', dim:'#6fa896', accent:'#00ff9c', title:'Exo 2',              body:'Exo 2',             fx:'particles', hue:-15,  acc:[]},
  reggae:     {name:'Reggae',     bg:'#0f150c', surface:'#1b2615', text:'#f6f0d6', dim:'#a7ad8c', accent:'#f2c230', accent2:'#e23a2e', accent3:'#2f9e44', title:'Baloo 2', body:'Baloo 2', fx:'waves', hue:-110, acc:[]}
};
