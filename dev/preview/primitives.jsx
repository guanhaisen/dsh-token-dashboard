/* Primitives stand-in for the preview: the shell's real controls are not part of
   this checkout, so the few the dashboard uses are drawn here with the same
   token vocabulary. Icons are inline SVG in the shell's outline style. */
import * as React from 'react'

export function SegmentedControl(props) {
  const { id, value, label, options, onChange } = props
  return React.createElement('div', {
    className: 'segmented',
    role: 'radiogroup',
    'aria-label': label,
    'data-control-id': id,
  }, options.map((option) => React.createElement('button', {
    key: option.value,
    type: 'button',
    role: 'radio',
    'aria-checked': option.value === value,
    className: option.value === value ? 'segment segmentOn' : 'segment',
    onClick: () => onChange?.(option.value),
  }, option.label)))
}

function icon(children) {
  return function Icon(props) {
    const size = props?.size ?? 16
    return React.createElement('svg', {
      width: size,
      height: size,
      viewBox: '0 0 16 16',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.3,
      'aria-hidden': 'true',
      children,
    })
  }
}

export const IconDataOutlineRegular = icon(React.createElement(React.Fragment, null,
  React.createElement('ellipse', { cx: 8, cy: 4, rx: 5, ry: 2.2 }),
  React.createElement('path', { d: 'M3 4v4c0 1.2 2.2 2.2 5 2.2s5-1 5-2.2V4' }),
  React.createElement('path', { d: 'M3 8v4c0 1.2 2.2 2.2 5 2.2s5-1 5-2.2V8' })))

export const IconRefreshOutlineRegular = icon(React.createElement(React.Fragment, null,
  React.createElement('path', { d: 'M13 8a5 5 0 1 1-1.6-3.7' }),
  React.createElement('path', { d: 'M13 2.6V5.4h-2.8' })))

export const primitives = {
  SegmentedControl,
  IconDataOutlineRegular,
  IconRefreshOutlineRegular,
}
