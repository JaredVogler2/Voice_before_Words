import type { AccessMethod } from '../access/controller';

/** The ways of choosing, described the same way everywhere they are offered. */
export const METHODS: { id: AccessMethod; icon: string; title: string; help: string }[] = [
  { id: 'touch', icon: 'touch', title: 'Touch', help: 'Tap the pictures with a finger, knuckle or stylus.' },
  {
    id: 'gaze',
    icon: 'eye',
    title: 'Eyes',
    help: 'Look at something to choose it, using the front camera. A camera can only tell large areas apart, so choices are big and a word takes two looks. Best on a tablet, propped still, in good light.',
  },
  {
    id: 'head',
    icon: 'head',
    title: 'Head',
    help: 'Point your nose at a picture to choose it, using the front camera. Usually steadier and finer than eye pointing.',
  },
  {
    id: 'scan',
    icon: 'scan',
    title: 'Scanning with one switch',
    help: 'Choices light up in turn. Blink, raise your eyebrows, press a switch or tap anywhere to pick the lit one.',
  },
  {
    id: 'dwell',
    icon: 'pointer',
    title: 'Pointer dwell',
    help: 'For a head mouse, trackball or an eye tracker that moves the mouse pointer. Rest the pointer on a picture to choose it.',
  },
];
