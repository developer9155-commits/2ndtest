/* =====================================================================
   config.js — your settings (the ONLY file you need to edit for most changes)
   ---------------------------------------------------------------------
   • links    : your contact and project URLs. Leave '' (empty) if not ready.
                Empty links show a "not set yet" note instead of a broken link.
   • text     : small facts shown in the Education panel.
   • models   : OPTIONAL real 3D model files (see README, section 9).
   • views    : camera positions for the Home and Explore screens.
   • hotspots : the glowing markers in the 3D world (label, preview, position,
                and where the camera flies when it is clicked).

   Positions are written as [x, y, z]. x = right, y = up, z = toward you.
   The island is now about 30 units from its centre to its edge. The village,
   farm and hills are in the middle; the city and the Astropulse SMM office
   are on the south side (large z values). world.js scales everything up
   for you, so write positions in these plain units.
   ===================================================================== */

export const CONFIG = {
  name: 'Murari Kumar',

  /* ---- Links -------------------------------------------------------
     email          : just the address, e.g. 'you@example.com'  (no "mailto:")
     github/linkedin: full address starting with https://
     nexoraRepo     : paste your Nexora AI GitHub repository URL when ready
     astropulseLive : the Astropulse SMM website or profile link
  ------------------------------------------------------------------- */
  links: {
    email: 'murarikumarstm102@gmail.com',
    github: 'https://github.com/developer8709-max',
    linkedin: '',
    nexoraLive: 'https://nexora-ai-webbuilder.vercel.app/',
    nexoraRepo: '',
    cropLive: '',
    cropRepo: '',
    astropulseLive: 'https://astropulsesmm.vercel.app',
  },

  /* ---- Education panel --------------------------------------------- */
  text: {
    college: 'Centurion University ',     // e.g. 'Government Polytechnic, Your City'
    graduation: '2027',  // e.g. '2027'
  },

  /* ---- Optional real 3D models --------------------------------------
     Leave '' to use the built-in low-poly camper van.
     To use your own .glb file, upload it to an "assets" folder in the
     repository and write its relative path, e.g. 'assets/camper.glb'.
     If the file fails to load, the built-in van is used automatically.
  ------------------------------------------------------------------- */
  models: {
    camper: '',
    camperScale: 1,       // make the model bigger or smaller
    camperRotationY: 0,   // turn the model (in radians, 3.14 = half turn)
    camperOffset: [0, 0, 0],
  },

  /* ---- Camera views -------------------------------------------------
     The island is bigger now, so Home and Explore sit further back and
     look a little toward the south, so part of the city is in the frame.
  ------------------------------------------------------------------- */
  views: {
    home:      { position: [20, 9, 30],   target: [0, 2, 6] },
    explore:   { position: [22, 26, 38],  target: [0, 1, 9] },
    // Education has no marker, so it is opened from the menu only.
    education: { position: [-4.4, 4.4, 5.4], target: [-9.4, 1.0, -1.2] },
  },

  /* ---- Hotspots -----------------------------------------------------
     id       must match a panel in index.html (panel-about, panel-skills ...)
     position where the glowing marker floats
     camera   where the camera flies to when the marker is opened
  ------------------------------------------------------------------- */
  hotspots: [
    {
      id: 'about',
      label: 'About me',
      preview: 'A Diploma CSE student who builds for the web, Android and AI.',
      color: '#ff6b5e',
      position: [-4.5, 2.3, 7.4],
      camera: { position: [-0.2, 3.6, 13.6], target: [-4.8, 0.9, 7.2] },
    },
    {
      id: 'skills',
      label: 'Skills',
      preview: 'The languages, platforms and tools I work with.',
      color: '#8f7fe6',
      position: [2.0, 3.7, 9.5],
      camera: { position: [7.4, 4.3, 16.4], target: [2.0, 1.5, 9.5] },
    },
    {
      id: 'nexora',
      label: 'Nexora AI',
      preview: 'Featured project: an AI website builder that helps you publish online.',
      color: '#4fd1e0',
      position: [-0.5, 4.5, -3.2],
      camera: { position: [5.2, 5.6, 4.2], target: [-0.5, 2.0, -3.2] },
    },
    {
      id: 'crop',
      label: 'CropIndia AI',
      preview: 'Concept: crop production information and visualization.',
      color: '#e8b23a',
      position: [9.8, 3.4, 0.2],
      camera: { position: [16.5, 5.0, 7.0], target: [9.6, 0.9, 0.2] },
    },
    {
      // The glass office in the city, south side of the island. The marker
      // floats above its tower; the camera looks at the building from the front.
      id: 'astropulse',
      label: 'Astropulse SMM',
      preview: 'A social media marketing office with a team of nine, in the city.',
      color: '#ff4fa3',
      position: [-6.0, 8.0, 16.3],
      camera: { position: [-2.0, 6.0, 31.0], target: [-6.0, 2.5, 18.0] },
    },
    {
      id: 'contact',
      label: 'Contact',
      preview: 'Email, GitHub and LinkedIn.',
      color: '#4fae7a',
      position: [10.8, 2.6, 6.6],
      camera: { position: [15.5, 3.4, 12.2], target: [10.8, 1.1, 6.6] },
    },
  ],
};
