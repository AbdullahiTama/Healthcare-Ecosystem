import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

import PermissionMatrix from './PermissionMatrix.jsx'
import { NAV_GROUPS, ALL_TABS } from '../navigation'

const assignable = ALL_TABS.filter(i => i.key !== 'overview')

function setup(props = {}) {
  const onChange = vi.fn()
  const value = { users: true, posts: false, mystery_key: true }
  const utils = render(<PermissionMatrix value={value} onChange={onChange} label="Permitted sections" {...props} />)
  return { onChange, value, ...utils }
}

describe('PermissionMatrix', () => {
  it('is a fieldset named by its label', () => {
    setup()
    expect(screen.getByRole('group', { name: 'Permitted sections' })).toBeInTheDocument()
  })

  it('has one checkbox per assignable section, named by the section label, none for overview', () => {
    setup()
    const boxes = screen.getAllByRole('checkbox')
    expect(boxes).toHaveLength(assignable.length)
    assignable.forEach(i => expect(screen.getByRole('checkbox', { name: i.label })).toBeInTheDocument())
    expect(screen.queryByRole('checkbox', { name: 'Dashboard' })).toBeNull()
    expect(screen.getByText('Dashboard — always included')).toBeInTheDocument()
  })

  it('groups the sections under the navigation group headings', () => {
    setup()
    NAV_GROUPS.forEach(g => {
      const items = g.items.filter(i => i.key !== 'overview' && !i.permissionKey)
      if (!items.length) return
      const group = screen.getByRole('group', { name: g.label })
      items.forEach(i => expect(within(group).getByRole('checkbox', { name: i.label })).toBeInTheDocument())
    })
  })

  it('reflects the value', () => {
    setup()
    expect(screen.getByRole('checkbox', { name: 'Users' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Posts' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Shop' })).not.toBeChecked()
  })

  it('toggling calls onChange with a new object that keeps the others and unknown keys', () => {
    const { onChange, value } = setup()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Shop' }))
    expect(onChange).toHaveBeenCalledTimes(1)
    const next = onChange.mock.calls[0][0]
    expect(next).toEqual({ users: true, posts: false, mystery_key: true, shop: true })
    expect(next).not.toBe(value)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Users' }))
    expect(onChange.mock.calls[1][0]).toEqual({ users: false, posts: false, mystery_key: true })
  })

  it('never mutates value', () => {
    const { value } = setup()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Shop' }))
    expect(value).toEqual({ users: true, posts: false, mystery_key: true })
  })

  it('disabled disables every checkbox and lists the enabled sections as text', () => {
    setup({ disabled: true })
    screen.getAllByRole('checkbox').forEach(b => expect(b).toBeDisabled())
    expect(screen.getByText('Allowed: Users')).toBeInTheDocument()
  })

  it('disabled with nothing enabled says so', () => {
    setup({ disabled: true, value: {} })
    expect(screen.getByText('Dashboard only')).toBeInTheDocument()
  })

  it('tolerates a missing value', () => {
    setup({ value: undefined })
    screen.getAllByRole('checkbox').forEach(b => expect(b).not.toBeChecked())
  })
})
