# Disclaimers

**Day and Night**, by Black Canyon Software

These disclaimers are part of the End User Licence Agreement (`EULA.md`). They
are repeated here on their own so they can be read in two minutes.

## A picture that stays on your screen

Day and Night is a wallpaper. It is meant to be left on, and most of the time
it is almost still: the sky changes slowly, so the same picture can sit in the
same place for a long stretch, and the sun or moon can stay in roughly one
position for hours.

Some screens - OLED and plasma especially, and some LCDs - can hold a faint
image of whatever was shown on them for a long time. This is called image
retention or burn-in, it is a property of the screen rather than of this
Software, and any mostly-still picture can cause it, including the wallpaper
your computer came with.

What the Software does about it: it stops drawing entirely when your session is
locked, when the computer goes to sleep, when an application is running full
screen, and, by default, when a laptop is on battery. The picture also moves
through the day on its own.

What it does not do: it does not decide when your screen turns off, and it does
not dim or shift the picture to protect a screen. If you have a screen that is
prone to image retention, use its own protections - your screen's pixel-shift
or panel-refresh setting, and your computer's setting for turning the display
off when idle. We are not responsible for image retention or burn-in on any
screen.

## The sky is decoration, not an instrument

The sun and moon are placed using standard published astronomical algorithms,
and they agree with those algorithms' own worked examples to far better than the
half a degree the product aims for. That is a statement about arithmetic, not a
promise about your sky.

Do not rely on the Software for anything that depends on being right:
navigation, surveying, aviation or marine use, planning a photograph that has to
work, timing a religious observance, or any decision where a wrong sunrise
matters. Use a published almanac or an official source for those.

In particular, the Software:

- draws an unobstructed horizon at sea level. It does not know about your hills,
  buildings, trees or altitude, so the sun will rise on screen before it clears
  the ridge outside;
- has no idea what the weather is. It is always clear;
- takes the time from your computer. A wrong clock or a wrong time zone gives a
  wrong sky, and nothing in the Software can detect that;
- is only as right about where you are as what you told it, or as the guess it
  made from your time zone, which is the middle of a large region.

## How it draws behind your desktop icons

To put a moving picture behind your desktop icons, the Software attaches its own
window to the part of Windows Explorer that draws the desktop background. That
part of Windows is not documented by Microsoft, and the Software is not using an
official interface for it, because there is not one.

This works today on Windows 10 and 11. It can stop working. A Windows update,
another wallpaper program running at the same time, a replacement desktop shell,
or some remote-desktop sessions can all prevent it. When that happens, the
Software shows its sky in an ordinary window instead, so that you can see
something has changed rather than finding a blank desktop. Running two wallpaper
programs at once is not supported by either of them.

## Health: pulsing imagery

The Software draws stars that twinkle and a sun with a glare around it. By
default both are slow and gentle, and nothing in the shipped looks flashes. But
the controls can be set outside those defaults: the twinkle and glare settings
can be pushed up, and the result is on a screen that is in front of you for
hours.

A small number of people have seizures or other symptoms triggered by flashing
lights or certain visual patterns, including people with no history of them. If
you or anyone in your household has a history of epilepsy or seizures, consult a
doctor before using fast or strong twinkle settings. Stop using the Software and
consult a doctor if you experience dizziness, altered vision, eye or muscle
twitching, loss of awareness, disorientation, involuntary movement or
convulsions. Keep a wallpaper for a shared screen, a classroom or a lobby within
the gentle range the shipped looks use.

## Hardware and power

The Software runs all the time you are at your computer, which is the point of
it. It is built to be cheap about it: it redraws only when the picture would
actually look different, which on the machine we measured came to a fraction of
one per cent of one processor core, and it stops completely in the situations
listed above.

Even so, it is a program that is running: it uses some processor and graphics
time and some memory, which means some power. On a laptop it stops on battery
unless you tell it not to. Nothing the Software does can harm hardware in normal
operation, and we are not responsible for the effects of choosing to run it
continuously on a machine or a battery that is not up to it.

## Other people's software

Windows, Windows Explorer, your graphics driver, your screen saver and any other
wallpaper or desktop program belong to their makers. We are not affiliated with
them and we do not control how they behave alongside us. Where our documentation
gives advice about such a program, it is advice from our own testing, which may
fall out of date.

## Your files

Your settings and your presets are stored on your own computer (`PRIVACY.md`
says where). Keep your own copies of any preset you care about. We have no copy
and cannot recover one.

## The software is provided as is

The Software is provided "as is" and "as available". We do not promise it is
free of errors, that it will work on every computer, or that it will work with
every other program. The full warranty disclaimer and the limits on our
liability are in sections 8 to 10 of the EULA, together with the consumer rights
that those limits do not touch.

## Support

Support is provided as described on the store page and in the documentation, on
a best-effort basis. It is not a promise of a fix or a response time, except
where the store's own terms or the law provide one.
