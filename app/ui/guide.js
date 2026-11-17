// @ts-check
/**
 * The guide: what the application does and what each panel is for, in plain
 * words.
 *
 * It is text in the page rather than a file for the same reason the controls'
 * hints are: it has to be there with no network, in a browser or in the
 * application, and it cannot drift out of the build it describes. A test holds it
 * to the panels that exist, so a panel added without a paragraph here, or a
 * paragraph for a panel that is gone, fails.
 *
 * The hints on each control's `i` explain one control. This explains the shape of
 * the whole: what to touch first, what each panel is for, and what to do when
 * something looks wrong.
 *
 * @module ui/guide
 */

/**
 * The three things a new user does, in order, for the welcome card.
 *
 * @type {readonly string[]}
 */
export const WELCOME_STEPS = [
  "Say where you are, in the Place panel. It is guessed from your time zone to start with; a city or two coordinates make it exact.",
  "Pick a look from the Look panel, or just leave it as it is. Everything is the real sky for your place and the time of day.",
  "Press Turn the wallpaper on. It sits behind your icons, on every screen, and keeps going when you close this window."
];

/**
 * One paragraph for each panel, in the order the panels appear. The key is the
 * panel's own heading, which is what lets a test check the two agree.
 *
 * @type {readonly { panel: string, text: string }[]}
 */
export const PANELS = [
  {
    panel: "Look",
    text: "Complete looks, laid over the defaults: a picture of each, and one click to wear it. They change how the sky is dressed and never where the sun is, so every look is still the real sky for your place. Change any control afterwards and the panel calls it Custom."
  },
  {
    panel: "Share",
    text: "Your look as one short string, to paste into a message. A code carries only how it looks: not where you are, not your frame rate, and not whether the real weather is on, so pasting a stranger's code can never move your sky or send anything anywhere."
  },
  {
    panel: "Place",
    text: "Where you are, which decides when the sun rises, how high it climbs, which stars are up and which way the moon faces. Type coordinates, drag the sliders, or pick a city. Nothing is looked up on the internet."
  },
  {
    panel: "Sky",
    text: "How bright the whole picture is, and how far the brightest parts are allowed to glow before they clip to white. The sky itself is physics, scattered light, so exposure changes how it is photographed and not what is there."
  },
  {
    panel: "View",
    text: "Which way you face, how wide the view is and where the horizon sits down the picture. Facing south from the northern hemisphere is the default, because that is where the sun goes. The sun's true position never changes with these; only how much of the sky you are shown."
  },
  {
    panel: "Grade",
    text: "How hazy the air is, saturation and contrast, and a colour cast each for day, twilight and night. A hazier sky is whiter and gives deeper sunsets. This is the one place the picture is authored, on top of a sky that is already physically right, and leaving it neutral leaves the physics exactly as it is."
  },
  {
    panel: "Horizon",
    text: "What stands between you and the sky: nothing, mountains, a city or a treeline. They are computed rather than drawn, so every number is a different one; the seed walks through them. A city has lights that come on at dusk and thin out through the night."
  },
  {
    panel: "Clouds",
    text: "How much cloud, how big its features are, how sharp their edges, and how fast the wind carries them. The wind wanders from day to day in a simulation, or you fix a direction. Use the real weather, in this panel, replaces all of it with MET Norway's forecast for your place; see Real weather below."
  },
  {
    panel: "Weather",
    text: "Fog, rain and snow. Fog is thickest at the ground and swallows the horizon first. Rain and snow fall in three layers, leaning with the wind. They are lit by the sky around them, so they show best in daylight and by a city at night. Rain and snow make the sky redraw every frame, which costs more than anything else here; fog costs nothing extra."
  },
  {
    panel: "Sun and moon",
    text: "How much they glare and how much larger than life they are drawn. They are always where they really are; this only changes how they look."
  },
  {
    panel: "Stars",
    text: "How bright the stars are, how large, how much they twinkle, and how much glow the night sky has of its own. The planets have their own slider, and they are real: where Venus, Mars, Jupiter, Saturn and Mercury actually are tonight. The stars are generated, with the right brightness mix and the right motion, but there is no Orion; a real catalogue is still to come."
  },
  {
    panel: "Screens",
    text: "Your monitors, drawn to scale. One sky is composed across all of them and each screen draws its own slice, so the sun crosses from one to the next without a seam. Windows decides where the screens are; this only shows it."
  },
  {
    panel: "About",
    text: "Which build this is, this guide, and the licence, privacy notice and credits that ship with every build, readable with no internet."
  },
  {
    panel: "Performance",
    text: "How often the wallpaper redraws, whether it starts with Windows, and when it stops because you are away. A still sky costs almost nothing; clouds cost a little, and rain, snow and the stars' twinkle cost the most. Stopping when you are away is what keeps it free when nobody is looking."
  }
];

/**
 * The whole guide as one text, for the reader dialog.
 *
 * @returns {string}
 */
export function guideText() {
  const lines = [
    "DAY AND NIGHT",
    "",
    "A live wallpaper that draws the real sky for your place and the time of day. There is no video and no loop: the picture is worked out from the clock and where you are, so what is behind your windows and what is behind your icons agree. It draws itself on every screen at once and keeps going with this window closed.",
    "",
    "GETTING STARTED",
    ""
  ];

  WELCOME_STEPS.forEach((step, i) => lines.push(`${i + 1}. ${step}`, ""));

  lines.push(
    "Open a panel on the left to change anything. Every control has an i beside it that says what it does and what it costs. Nothing you do here can make the sun be in the wrong place.",
    "",
    "THE PANELS",
    ""
  );

  for (const { panel, text } of PANELS) lines.push(`${panel.toUpperCase()}`, text, "");

  lines.push(
    "THE TIME BAR",
    "",
    "Along the top. Drag it to see any hour of the day, pick a date to see any season, press Fast forward to watch a day go by in about thirty seconds, and Now to come back. This only changes the preview; the wallpaper always shows the real now.",
    "",
    "REAL WEATHER",
    "",
    "Off until you turn it on, and the only thing in this application that uses the internet. Turned on, it sends your location rounded to a tenth of a degree, and your IP address like any request, to MET Norway about once an hour, and nothing else. It then moves the clouds with the real wind and sets cloud cover, rain, snow and fog from the forecast for as long as it covers the moment. The controls it sets are dimmed while it is on. If it cannot be reached your own settings carry on. Nothing is sent while it is off, and a settings file, a share code or Undo cannot turn it on for you. The privacy notice in About says all of it.",
    "",
    "KEYBOARD",
    "",
    "Ctrl+Z undoes and Ctrl+Y puts it back (so does Ctrl+Shift+Z). Tab moves through the controls and Escape closes a dialog. In the Look panel the arrow keys move between looks.",
    "",
    "IF SOMETHING LOOKS WRONG",
    "",
    "The wallpaper is not behind my icons: it says so in the panel if it had to draw in front of the desktop instead, which is visibly worse; that depends on a part of Windows that is not documented.",
    "",
    "It stopped moving: it stops on purpose when you have been away for a while (see Performance), when a full-screen game is running, and when the screen is locked. It starts again the moment you are back.",
    "",
    "The sky is for the wrong place: check the Place panel. The first run guesses from your time zone and says so.",
    "",
    "It is using too much: lower the frame rate, turn off Twinkle and anything falling, and make sure it stops when you are away.",
    "",
    "Where my settings live: in settings.json in the application-data folder for your Windows user account. Delete it to start again."
  );

  return lines.join("\n");
}
