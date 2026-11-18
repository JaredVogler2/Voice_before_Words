import type { ReactNode } from 'react';
import { Icon } from './Icon';

/**
 * Settings controls. Each one is a plain button underneath, so every setting
 * can be changed by touch, keyboard, dwell or switch scanning alike. Sliders
 * are avoided on purpose: dragging needs fine motor control, a step button does not.
 */

export function Row({ title, help, children, column }: { title: string; help?: ReactNode; children?: ReactNode; column?: boolean }) {
  return (
    <div className={column ? 'row column' : 'row'}>
      <div className="row-text">
        <div className="row-title">{title}</div>
        {help ? <div className="row-help">{help}</div> : null}
      </div>
      {children}
    </div>
  );
}

export function Toggle({ title, help, value, onChange, id }: { title: string; help?: ReactNode; value: boolean; onChange: (value: boolean) => void; id: string }) {
  return (
    <div className="row">
      <div className="row-text">
        <div className="row-title" id={`${id}-label`}>{title}</div>
        {help ? <div className="row-help">{help}</div> : null}
      </div>
      <button type="button" className="switch" role="switch" aria-checked={value} aria-labelledby={`${id}-label`} data-access={`set:${id}`} onClick={() => onChange(!value)} />
    </div>
  );
}

export interface Choice<T extends string | number> {
  value: T;
  label: string;
}

export function Segmented<T extends string | number>({ value, choices, onChange, id, label, wrap }: { value: T; choices: Choice<T>[]; onChange: (value: T) => void; id: string; label: string; wrap?: boolean }) {
  return (
    <div className={wrap ? 'segmented wrap' : 'segmented'} data-count={choices.length} role="radiogroup" aria-label={label}>
      {choices.map((choice) => (
        <button key={String(choice.value)} type="button" className="segment" role="radio" aria-checked={choice.value === value} data-access={`set:${id}:${choice.value}`} onClick={() => onChange(choice.value)}>
          {choice.label}
        </button>
      ))}
    </div>
  );
}

export function Stepper({ value, min, max, step, format, onChange, id, label }: { value: number; min: number; max: number; step: number; format: (value: number) => string; onChange: (value: number) => void; id: string; label: string }) {
  const clamp = (next: number) => Math.round(Math.max(min, Math.min(max, next)) * 1000) / 1000;
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" className="iconbtn" aria-label={`Less: ${label}`} disabled={value <= min} data-access={`set:${id}:less`} onClick={() => onChange(clamp(value - step))}>
        <Icon name="minus" />
      </button>
      <output aria-live="polite">{format(value)}</output>
      <button type="button" className="iconbtn" aria-label={`More: ${label}`} disabled={value >= max} data-access={`set:${id}:more`} onClick={() => onChange(clamp(value + step))}>
        <Icon name="plus" />
      </button>
    </div>
  );
}

export function NavRow({ icon, title, help, onClick, id }: { icon: string; title: string; help?: string; onClick: () => void; id: string }) {
  return (
    <button type="button" className="row nav-row" data-access={`nav:${id}`} onClick={onClick}>
      <span className="nav-icon"><Icon name={icon} /></span>
      <span className="row-text">
        <span className="row-title" style={{ display: 'block' }}>{title}</span>
        {help ? <span className="row-help" style={{ display: 'block' }}>{help}</span> : null}
      </span>
      <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
    </button>
  );
}

export function PageHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <header className="page-head">
      <button type="button" className="iconbtn" aria-label="Back" data-access="page:back" onClick={onBack}>
        <Icon name="back" />
      </button>
      <h1>{title}</h1>
    </header>
  );
}
