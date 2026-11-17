# Privacy notice

**Day and Night**, by Black Canyon Software
November 2026

## The short version

The Software collects nothing. It has no account, no sign-in, no analytics, no
telemetry and no advertising. As installed it makes no network connections at
all: it runs entirely on your computer, and the only thing it writes is your own
settings, on your own disk.

There is one optional feature that goes online, **Use the real weather**. It is
off until you turn it on, and [what it sends](#the-real-weather-optional-off-by-default)
is described below in full.

Where you are is the one piece of personal information the Software needs. It
stays on your computer, apart from that one feature, which sends it rounded to
a tenth of a degree (about 11 kilometres) and only if you turn it on.

## What is stored, and where

- **Your settings, including your location.** The current settings are saved
  automatically so they are there when you come back, in `settings.json` in the
  application-data folder for your Windows user account
  (`%APPDATA%\dayandnight`). The file is a list of control values, a latitude
  and longitude, a version number and the time it was saved. Nothing else in it
  identifies you.
- **Preset files you choose to save.** Written where you choose. They contain
  settings, and no location.

That is the complete list. Uninstalling the Software and deleting those files
removes everything it ever stored. The weather data the real-weather feature
fetches is kept in memory only and is discarded when you turn the feature off or
quit.

## The real weather (optional, off by default)

In the Clouds panel, **Use the real weather** follows the real weather for your
place, taken from the forecast of MET Norway (the Norwegian Meteorological
Institute), instead of the Software's simulated weather: the clouds move with the
real wind, and cloud cover, rain, snow and fog follow the forecast hour by hour
for as long as it lasts. (This box was called **Use the real wind** in an earlier
version, when it did only the first of those; it sends the same things, and
asks for no more.)

**Nothing is sent until you tick it, and nothing is sent while it is unticked.**
It is saved with your settings, so if you ticked it it starts again with the
Software. A settings file, a share code or an undo cannot tick it for you.

**What is sent, when it is on:**

- Your **latitude and longitude, cut to one decimal place** (a tenth of a
  degree, about 11 kilometres), in the address of the request. The decimals
  beyond that never leave your computer.
- Your **IP address**, which any request to any server includes. We run no
  server of our own in between, so MET Norway sees it directly. MET Norway's own
  documentation calls an IP address together with coordinates personal data, and
  treats it under its own terms.
- The name and version of the Software and our contact address
  (`developer@blackcanyonsoftware.com`), which MET Norway requires of everyone
  who uses its service, so that it can reach us rather than block us.

Nothing else: no account, no identifier, no settings, no history of where you
have been.

**When:** once when you turn it on, again about once an hour while the editor is
open or the wallpaper is on, and when you move your location to somewhere
different. Not when neither is open. If MET Norway cannot be reached, the
Software tries again later, more slowly each time, and the simulated weather
carries on.

**What comes back** is a weather forecast for that place - wind, cloud cover,
rain and snow, and a note of fog - kept in memory, shown to the screens, and
discarded when you untick the box or quit. It is one response; reading more of it
sends nothing more.

MET Norway's handling of a request is described by MET Norway, at
[api.met.no](https://api.met.no/doc/TermsOfService). Their data is licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), and the Software
credits them in the panel whenever it is in use.

## How it knows where you are

Three ways, and you can see and change the result at any time in the Place
panel:

1. **You type coordinates**, or drag the latitude and longitude sliders.
2. **You pick a city** from the list that comes with the Software. The list is
   part of the download; searching it contacts nothing.
3. **The Software guesses once, on first run**, from the time zone your computer
   is already set to - for example, `America/Denver` becomes the coordinates of
   Denver. It reads a setting that is already on your machine. It does not use
   your IP address, your network, Windows Location Services, or any service. If
   it does not recognise your time zone it guesses nothing and tells you so,
   rather than putting you somewhere plausible and wrong.

A later version may offer a location lookup that uses the network. If it ever
exists it will happen only when you click it, it will say what it is about to
send before it sends anything, and it will be possible to never use it. Until
then, there is nothing to turn off.

## Crash reports

A future version may offer to send a crash report when something goes wrong. It
will be opt-in, shown to you in full before anything is sent, and will contain
the error, the version of the Software, the kind of operating system, and the
settings in use. It is designed to contain no personal data. Until that version
exists, nothing is sent, ever.

## Stores

If you got the Software from a store, that store handles the purchase, your
account, the download and updates. What it collects is covered by its own
privacy policy, not by this notice. We receive from a store only the aggregated
sales and review figures every publisher receives; we do not receive your name,
email or payment details.

## Children

The Software has no user accounts, no chat, no purchases of its own and no
content from other users, and it collects no data from anyone, including
children.

## Changes

If this notice changes, the new version ships with the update that needs it, and
the change is listed in the Software's changelog.

## Contact

Questions about this notice: developer@blackcanyonsoftware.com
