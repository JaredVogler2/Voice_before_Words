import { useEffect, useRef, useState } from 'react';
import type { CalibrationStatus } from '../access/calibration';
import { access, modelKey, viewportSize } from '../access/controller';
import { gradeCalibration, recommendedTargetSize, type CalibrationGrade, type PointerSource } from '../access/gazeModel';
import { speaker } from '../speech/speaker';
import { useSettings } from '../state/settings';
import { useTrial } from '../state/trial';
import { Segmented } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { go, useAccessStatus } from '../ui/hooks';

/**
 * Calibration, start to finish, without needing hands: once a face has been in
 * view for a few seconds the dots begin on their own, each dot moves on by
 * itself, and the result screen continues to the board after a short pause.
 */

type Stage = 'ready' | 'running' | 'done';

const COUNTDOWN_SECONDS = 4;
const CONTINUE_SECONDS = 7;

const GRADE_TITLE: Record<CalibrationGrade, string> = { good: 'Good', fair: 'Usable', poor: 'Not accurate yet' };

const GRADE_TEXT: Record<PointerSource, Record<CalibrationGrade, string>> = {
  gaze: {
    good: 'That is about as accurate as a camera can be. It can tell large areas of the screen apart, not small ones, so the board uses big targets and words are chosen in two looks: the group, then the word.',
    fair: 'Pointing is a little loose, so the targets will be larger. Light on your face from the front, a device that is propped rather than held, and clean glasses usually help.',
    poor: 'The targets will be very large. Try again with light on your face from the front and the device propped still. Head pointing and scanning need much less accuracy than eye pointing.',
  },
  head: {
    good: 'Pointing is accurate enough for a full board on this screen.',
    fair: 'Pointing is a little loose, so the board will use larger tiles.',
    poor: 'The board will use very large tiles. Better light on your face and a steadier device often help. Scanning needs no pointing at all.',
  },
};

export function CalibrationView() {
  const settings = useSettings();
  const status = useAccessStatus();
  const source: PointerSource = settings.access.method === 'head' ? 'head' : 'gaze';
  const [stage, setStage] = useState<Stage>('ready');
  const [progress, setProgress] = useState<CalibrationStatus | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<{ grade: CalibrationGrade; errorPx: number; degrees: number | null; columns: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [continueIn, setContinueIn] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Camera on as soon as the screen opens.
  useEffect(() => {
    void access.tracker.start();
  }, []);

  // Show the person what the camera sees, so they can line themselves up.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || stage !== 'ready') return;
    video.srcObject = access.tracker.stream;
    void video.play().catch(() => undefined);
    return () => {
      video.srcObject = null;
    };
  }, [status.camera, stage]);

  const begin = async () => {
    setCountdown(null);
    setFailed(false);
    const started = await access.startCalibration(source);
    if (!started) return;
    setStage('running');
    void speaker.speak(source === 'gaze' ? 'Look at each dot until it moves.' : 'Point your nose at each dot until it moves.', {
      rate: settings.voice.rate,
      pitch: settings.voice.pitch,
      volume: settings.voice.volume,
      voiceUri: settings.voice.voiceUri,
      language: settings.voice.language,
      onDeviceVoicesOnly: settings.voice.onDeviceOnly,
      pronunciations: [],
    });
  };

  // Hands-free start: a face in view begins a short countdown.
  useEffect(() => {
    if (stage !== 'ready' || status.camera !== 'running') return;
    if (!status.face) {
      setCountdown(null);
      return;
    }
    setCountdown((current) => current ?? COUNTDOWN_SECONDS);
  }, [stage, status.camera, status.face]);

  useEffect(() => {
    if (countdown === null || stage !== 'ready') return;
    if (countdown <= 0) {
      void begin();
      return;
    }
    const timer = window.setTimeout(() => setCountdown((current) => (current === null ? null : current - 1)), 1000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown, stage]);

  useEffect(
    () =>
      access.on((event) => {
        if (event.type === 'calibration') setProgress(event.status);
        if (event.type === 'calibrated') {
          const screen = viewportSize();
          const model = event.result.model;
          if (!model) {
            setFailed(true);
            setStage('done');
            return;
          }
          useSettings.getState().saveModel(modelKey(event.source, screen), model);
          setOutcome({
            grade: gradeCalibration(model.errorPx, screen, model.pxPerDegree),
            errorPx: model.errorPx,
            degrees: model.pxPerDegree ? model.errorPx / model.pxPerDegree : null,
            columns: Math.max(2, Math.floor(screen.width / recommendedTargetSize(model.errorPx, model.pxPerDegree))),
          });
          setStage('done');
          setContinueIn(CONTINUE_SECONDS);
        }
      }),
    [],
  );

  // Carry on to the board without needing a tap.
  useEffect(() => {
    if (continueIn === null || stage !== 'done') return;
    if (continueIn <= 0) {
      go('/');
      return;
    }
    const timer = window.setTimeout(() => setContinueIn((current) => (current === null ? null : current - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [continueIn, stage]);

  useEffect(() => () => access.cancelCalibration(), []);

  // A method being tried from the hands-free menu: if calibration cannot be
  // done, the person has no way to say so. Go back to what worked.
  const trial = useTrial((state) => state.trial);
  useEffect(() => {
    if (!trial || stage !== 'done' || !failed) return;
    const timer = window.setTimeout(() => {
      useTrial.getState().revert();
      go('/');
    }, 12000);
    return () => window.clearTimeout(timer);
  }, [trial, stage, failed]);

  const leave = () => {
    access.cancelCalibration();
    go('/');
  };

  if (stage === 'running') {
    const dot = progress?.dot;
    const size = viewportSize();
    return (
      <div className="calibration" role="application" aria-label="Calibration in progress">
        {dot ? (
          <div className="dot" data-checking={progress?.checking} style={{ transform: `translate(${dot.x * size.width}px, ${dot.y * size.height}px)`, ['--progress' as string]: progress?.progress ?? 0 }}>
            <i />
          </div>
        ) : null}
        <div className="calibration-foot">
          <span>
            {progress?.waitingForFace
              ? 'I can’t see your eyes. Face the screen.'
              : progress?.checking
                ? 'Checking accuracy…'
                : source === 'gaze'
                  ? 'Look at the dot'
                  : 'Point your nose at the dot'}
          </span>
          <div className="meter" aria-hidden="true">
            <i style={{ width: `${progress ? (progress.index / progress.total) * 100 : 0}%` }} />
          </div>
          <button type="button" className="btn" data-direct onClick={leave}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (stage === 'done') {
    return (
      <div className="calibration">
        {failed || !outcome ? (
          <>
            <h1>That didn’t work</h1>
            <p>Too few dots could be read. Make sure your whole face is in view and lit from the front, then try again.</p>
            {trial ? <p>In a few seconds this goes back to the way of choosing you were using before.</p> : null}
          </>
        ) : (
          <>
            <span className="grade" data-grade={outcome.grade}>
              <Icon name={outcome.grade === 'poor' ? 'warning' : 'check'} />
              {GRADE_TITLE[outcome.grade]}
            </span>
            <h1>{source === 'gaze' ? 'Eye pointing is set up' : 'Head pointing is set up'}</h1>
            <p>{GRADE_TEXT[source][outcome.grade]}</p>
            <p>
              Measured error: {outcome.degrees !== null ? `roughly ${(Math.round(outcome.degrees * 2) / 2).toFixed(1)} degrees (${Math.round(outcome.errorPx)} pixels)` : `about ${Math.round(outcome.errorPx)} pixels`}. Targets will be {outcome.columns} across.{' '}
              {source === 'gaze'
                ? 'Keep your head where it is now: after moving, calibrate again from the menu.'
                : 'If the device is moved, calibrate again from the menu.'}
            </p>
          </>
        )}
        <div className="inline" style={{ justifyContent: 'center' }}>
          <button type="button" className="btn" data-direct onClick={() => { setOutcome(null); setContinueIn(null); setStage('ready'); }}>
            <Icon name="target" />
            Try again
          </button>
          {!failed ? (
            <button type="button" className="btn primary" data-direct onClick={() => go('/')}>
              Start talking{continueIn !== null ? ` (${continueIn})` : ''}
            </button>
          ) : (
            <button type="button" className="btn" data-direct onClick={() => go('/settings/access')}>
              Choose another way
            </button>
          )}
        </div>
      </div>
    );
  }

  const cameraProblem = status.camera === 'error' ? status.cameraError?.message : null;
  return (
    <div className="calibration">
      <h1>{source === 'gaze' ? 'Set up eye pointing' : 'Set up head pointing'}</h1>
      <div className="preview" data-face={status.face}>
        <video ref={videoRef} playsInline muted aria-label="Camera preview" />
        <div className="oval" />
      </div>
      {cameraProblem ? (
        <p role="alert">{cameraProblem}</p>
      ) : status.camera !== 'running' ? (
        <p>Starting the camera…</p>
      ) : !status.face ? (
        <p>Hold or prop the device so your whole face is inside the oval, about an arm’s length away, with light on your face.</p>
      ) : (
        <p>
          {source === 'gaze' ? 'Keep your head still and follow the dot with your eyes.' : 'Keep looking at the screen and point your nose at the dot.'}{' '}
          {countdown !== null ? `Starting in ${countdown}…` : ''}
        </p>
      )}
      <div style={{ width: 'min(320px, 86vw)' }}>
        <Segmented
          id="cal-points"
          label="How many dots"
          value={settings.access.calibrationPoints}
          choices={[
            { value: 5, label: 'Quick (5 dots)' },
            { value: 9, label: 'Careful (9)' },
          ]}
          onChange={(value) => settings.patch('access', { calibrationPoints: value })}
        />
      </div>
      <div className="inline" style={{ justifyContent: 'center' }}>
        <button type="button" className="btn" data-direct onClick={leave}>
          Not now
        </button>
        <button type="button" className="btn primary" data-direct disabled={status.camera !== 'running'} onClick={() => void begin()}>
          <Icon name="target" />
          Start now
        </button>
      </div>
      <p className="small" style={{ color: '#9a9eb3' }}>
        The camera picture is used on this device only. Nothing is recorded or sent anywhere.
      </p>
    </div>
  );
}
