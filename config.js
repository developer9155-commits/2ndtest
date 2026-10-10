/* =====================================================================
   config.js — your settings (the ONLY file you need to edit for most changes)
   ---------------------------------------------------------------------
   • links     : your contact and project URLs. Leave '' if not ready.
   • text      : small facts shown in the Education panel.
   • about     : the sentences the "About me" person says, one after another.
   • companies : details board + the team of each office (what each person
                 says when you visit them).
   • models    : OPTIONAL real 3D model files.
   • views     : camera positions for the Home and Explore screens.
   • hotspots  : the glowing markers in the 3D world.

   Positions are written as [x, y, z]. x = right, y = up, z = toward you.
   Offices are drawn smaller now, so their markers/cameras sit closer.

   HOW TO VISIT A COMPANY
     1. Click the company marker (Astropulse SMM, HealthGIS or Nexora AI).
        The gate and door open, the roof lifts off and a visitor walks in.
     2. At reception, type your name. The receptionist then walks you past
        every cabin and into the FOUNDER'S OFFICE, where you can ask
        Murari anything (answers come from Groq AI, see config.ai below).
     3. Press "Leave office" to finish. Afterwards you can DOUBLE-CLICK on
        empty space to meet the team one by one. In Explore, click the road
        to walk or choose a project's "Walk to" button for directions.
   ===================================================================== */

export const CONFIG = {
  name: 'Murari Kumar',

  links: {
    email: 'murarikumarstm102@gmail.com',
    github: 'https://github.com/developer8709-max',
    linkedin: '',
    nexoraLive: 'https://nexora-ai-webbuilder.vercel.app/',
    nexoraRepo: '',
    cropLive: '',
    cropRepo: '',
    astropulseLive: 'https://astropulsesmm.vercel.app',
    healthgisLive: '',
  },

  /* ---- AI chat (Groq) ----------------------------------------------
     Keep apiKey empty in a public website. Browser files are visible to
     every visitor; connect a server-side endpoint before enabling AI.
     Model note: Groq retired llama-3.3-70b-versatile on 16 Aug 2026, so the
        site uses openai/gpt-oss-120b. If it is ever removed, the site
        tries the fallback models in order. Check the live list at
        https://console.groq.com/docs/models                              */
  ai: {
    apiKey: '',
    model: 'openai/gpt-oss-120b',
    fallbackModels: ['openai/gpt-oss-20b', 'qwen/qwen3.6-27b'],
    maxAnswerTokens: 420,
    // Facts the AI may use when it answers AS Murari. Edit freely.
    knowledge: [
      'Name: Murari Kumar. Diploma Computer Science and Engineering student at Centurion University, graduating in 2027.',
      'Builds for the web (HTML, CSS, JavaScript, React), Android (Java) and AI-powered products. Also knows Python, C++, Firebase, DBMS, REST APIs, Git and GitHub.',
      'Featured project: Nexora AI, an AI website builder where you describe your idea and get a website you can publish online in minutes. Live at https://nexora-ai-webbuilder.vercel.app/',
      'Works with Astropulse SMM, a social media marketing company with a team of nine (content, design, ad campaigns, client reporting). Live at https://astropulsesmm.vercel.app',
      'HealthGIS: a concept that puts health information on interactive maps so patterns by area are easy to see.',
      'CropIndia AI: a concept for crop production information and visualization.',
      'Contact: email murarikumarstm102@gmail.com, GitHub https://github.com/developer8709-max',
      'Looking for chances to work with other developers, learn from real projects and build products that help people.',
    ].join('\n'),
  },

  /* In-world schedule only; it describes the portfolio character, not
     Murari's real-time location. Times use India Standard Time. */
  schedule: {
    timeZone: 'Asia/Kolkata',
    homeStart: 10,
    officeStart: 12,
    officeEnd: 24,
  },

  walkLocations: {
    house: [1.5, 20.8],
    astropulse: [-6.0, 22.6],
    healthgis: [-15.5, 13.6],
    nexora: [24.0, 0.6],
    crop: [10.3, 4.0],
    station: [20.9, 32.6],
    airport: [-22.6, 7.4],
  },

  text: {
    college: 'Centurion University',
    graduation: '2027',
  },

  /* ---- What the "About me" person says (shown in a speech bubble) ----
     Double-click on empty space to skip to the next sentence.
     Keep each sentence short and factual. */
  about: {
    lines: [
      'Hello, and welcome. I am Murari Kumar.',
      'I am a Diploma Computer Science and Engineering student at Centurion University, graduating in 2027.',
      'I build for the web, for Android and with AI, and I enjoy turning ideas into working products.',
      'My featured project is Nexora AI, an AI website builder that helps people publish online.',
      'I also work with Astropulse SMM, a social media marketing company with a team of nine.',
      'CropIndia AI is my concept for crop production information and visualization.',
      'HealthGIS brings health information onto interactive maps.',
      'Please explore the offices and projects, and feel free to contact me by email or GitHub.',
    ],
  },

  /* ---- Companies ----------------------------------------------------
     details : lines printed on the signboard in front of the office.
     team    : one entry per person, in the order they are listed here:
               desk 1-4, team lead, presenter, gate guard, courier,
               (Astropulse only) gardener.
               role = job title, say = what the person tells you.        */
  companies: {
    astropulse: {
      details: [
        'Social media marketing agency',
        'Team of nine specialists',
        'Content, design and ad campaigns',
        'Client reporting and growth',
        'Double-click to meet the team',
      ],
      team: [
        { role: 'Content Strategist', say: 'I plan the content calendar and make sure every post supports the client\'s goals.' },
        { role: 'Social Media Manager', say: 'I schedule posts, reply to audiences and track engagement every day.' },
        { role: 'Graphic Designer', say: 'I design the posters, reels and brand visuals that our campaigns use.' },
        { role: 'Client Support Executive', say: 'I am the first point of contact for clients. I answer calls and manage requests.' },
        { role: 'Team Lead', say: 'I review each desk, keep deadlines on track and support the team.' },
        { role: 'Strategy Lead', say: 'I present campaign ideas and monthly results to our clients.' },
        { role: 'Security Officer', say: 'I look after the office gate and welcome every visitor and delivery.' },
        { role: 'Delivery Executive', say: 'I bring parcels and documents to the office, safely and on time.' },
        { role: 'Facility Keeper', say: 'I keep the office garden fresh so the team has a pleasant place to work.' },
      ],
    },
    nexora: {
      details: [
        'AI website builder',
        'Describe your idea, get a website',
        'Publish online in minutes',
        'Live on nexora-ai-webbuilder.vercel.app',
        'Double-click to meet the team',
      ],
      team: [
        { role: 'AI Engineer', say: 'I work on the AI that turns a plain description into a complete website.' },
        { role: 'UI Designer', say: 'I design clean, responsive layouts so every generated site looks professional.' },
        { role: 'Customer Success', say: 'I help users publish their first website and answer their questions.' },
        { role: 'Full-Stack Developer', say: 'I connect the builder, the hosting and the publishing flow end to end.' },
        { role: 'Product Lead', say: 'I review progress at every desk and decide what we build next.' },
        { role: 'Product Demo Lead', say: 'I demonstrate Nexora AI and show how quickly an idea becomes a website.' },
        { role: 'Security Officer', say: 'I manage access to the office and keep our visitors comfortable.' },
        { role: 'Delivery Executive', say: 'I deliver documents and equipment to the Nexora AI office.' },
      ],
    },
    healthgis: {
      details: [
        'Health + GIS mapping platform',
        'Health data on interactive maps',
        'Helps spot patterns by area',
        'Clear dashboards for decisions',
        'Double-click to meet the team',
      ],
      team: [
        { role: 'GIS Analyst', say: 'I prepare the map layers that show health information by location.' },
        { role: 'Data Visualization Designer', say: 'I turn complex health numbers into charts that anyone can read.' },
        { role: 'Health Data Coordinator', say: 'I collect and verify the data and coordinate with partner organisations.' },
        { role: 'Software Developer', say: 'I build and maintain the HealthGIS website and its interactive features.' },
        { role: 'Project Lead', say: 'I check every desk and make sure each release is accurate and on schedule.' },
        { role: 'Public Health Advisor', say: 'I explain how location data can support better health decisions.' },
        { role: 'Security Officer', say: 'I look after the gate and make sure visitors are welcomed properly.' },
        { role: 'Delivery Executive', say: 'I bring reports and supplies to the HealthGIS office.' },
      ],
    },
  },

  models: {
    camper: '',
    camperScale: 1,
    camperRotationY: 0,
    camperOffset: [0, 0, 0],
  },

  views: {
    home:      { position: [20, 12, 30],  target: [0, 2, 6] },
    explore:   { position: [22, 26, 38],  target: [0, 1, 6] },
    house:     { position: [8, 10, 27],   target: [1.5, 1.2, 19.3] },
    station:   { position: [43, 32, 75],  target: [23, 2, 36] },
    airport:   { position: [-25, 26, -37], target: [-28, 2, -4] },
    education: { position: [-4.4, 4.4, 5.4], target: [-9.4, 1.0, -1.2] },
  },

  /* ---- Hotspots -----------------------------------------------------
     NEW: 'healthgis' needs a matching panel in index.html
          (id="panel-healthgis"). Copy the Astropulse panel and edit it.
     Nexora AI now lives at its own office (east of the island), where the
     old Nexora tower used to be is now open land.                         */
  hotspots: [
    {
      id: 'about',
      label: 'About me',
      preview: '',
      color: '#ff6b5e',
      position: [-4.5, 2.3, 7.4],
      camera: { position: [-0.2, 3.6, 13.6], target: [-4.8, 0.9, 7.2] },
    },
    {
      id: 'skills',
      label: 'Skills',
      preview: '',
      color: '#8f7fe6',
      position: [2.0, 3.7, 9.5],
      camera: { position: [7.4, 4.3, 16.4], target: [2.0, 1.5, 9.5] },
    },
    {
      // Nexora AI company office (east side of the island)
      id: 'nexora',
      label: 'Nexora AI',
      preview: 'Featured project: an AI website builder that helps you publish online.',
      color: '#8f7fe6',
      position: [24.0, 8.4, -5.2],
      camera: { position: [24.0, 19.0, 12.0], target: [24.0, 3.0, -4.0] },
    },
    {
      id: 'healthgis',
      label: 'HealthGIS',
      preview: 'Health information on interactive maps. Visit the team inside.',
      color: '#1fbf8f',
      position: [-15.5, 8.4, 7.8],
      camera: { position: [-15.5, 20.5, 19.5], target: [-15.5, 3.0, 9.0] },
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
      id: 'astropulse',
      label: 'Astropulse SMM',
      preview: 'A social media marketing office with a team of nine, in the city.',
      color: '#ff4fa3',
      position: [-6.0, 8.4, 16.8],
      camera: { position: [-6.0, 19.0, 31.0], target: [-6.0, 3.0, 18.0] },
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
