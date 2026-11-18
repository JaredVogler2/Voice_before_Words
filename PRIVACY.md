# Privacy

What someone says with a communication aid is as private as anything a person
says. This app is built so that, by default, none of it goes anywhere.

There is no server belonging to this project. There is no account, no
advertising, no analytics and no tracking, and the app loads nothing from any
other site.

## What is kept, and where

Everything below is kept **in the browser on the device**, and nowhere else.

| What | Why |
|---|---|
| Settings | So the app is set up the same way next time |
| Words, photos and quick phrases you add | They are part of the board |
| The last 200 sentences spoken | For "Said before", and to learn which words usually follow which |
| Calibration for eye or head pointing | A short list of numbers, never a picture |
| Answers from an AI model, if one is used | So the same message is not sent (and paid for) twice |
| An API key, if one is entered | So it need not be typed again. This can be switched off, and then the key is forgotten when the tab closes |

It can all be removed in **Settings → Privacy and your data**, piece by piece or
all at once. Clearing the browser's data for the site removes it too. A backup
file can be saved from the same page; it never contains the API key.

## The camera

Eye pointing, head pointing and face gestures use the front camera. Each frame
is turned into a few numbers (where the eyes and head are) on the device and
then thrown away. Nothing is recorded, stored or sent. The software that does
this is served by the app itself, not fetched from another company. The camera
is on only while one of those methods is switched on.

## The voice

Speech is made by the device's own text-to-speech. Some browsers also offer
voices that are made on the browser maker's servers, which means the sentence
is sent to them. **"Only voices on this device" is on by default**, so those are
not used unless you choose to allow them.

## An AI model, if you turn one on

This is off until someone adds a key and turns it on. When it is on:

- **Sent to the provider you chose:** the words of the message being built,
  each time it changes (from the second word). If you allow it: the last four
  sentences spoken, the "About me" notes, and anything typed into "What was
  just said to them?". Each of those can be switched off.
- **Never sent:** pictures, the camera, the rest of the history, settings, or
  anything else on the screen.
- **How:** straight from the browser to the provider, with your key. It does
  not pass through anyone else.

What the provider does with it is governed by their terms, not this project's.
Read them before using this with a child or anyone who cannot agree to it for
themselves. To keep every word on your own hardware, choose "Other" and point
it at a model running on your own computer.

## Whoever hosts the app

The app is a set of files. The service that hosts them will see what any web
host sees when a page is fetched (an internet address, the time, the browser).
It does not see what is said, because that never leaves the device. Once the
app has been opened it works without the internet.

## If something here is wrong

The code is open. If the app does anything this page says it does not, that is
a bug: please open an issue.
