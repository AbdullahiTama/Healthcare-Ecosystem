import { useState, useEffect, useRef } from 'react'
import {
  getActivityFields, addActivityField, deleteActivityField,
  getDefaultViewers, setDefaultViewers,
  getFieldActivities, getActivityViewers, getActivityReactions, getActivityComments,
  logActivity, reactToActivity, unreactToActivity, commentOnActivity,
  uploadActivityVoice, reverseGeocode,
} from '../../services/supabase'
// Cross-aggregate reads: activity is logged by staff, against a territory.
import { territoryRepository } from '../territories/repositories'
import { staffRepository } from '../staff/repositories'
import { watchTable } from '../../lib/realtime'
import { Card, Inp, TealBtn, GhostBtn, Modal, useToast, Toast, ConfirmDialog, Loading } from '../../components/ui'
import { theme } from '../../styles/theme'
const { tealDeep, tealMist, tealBright, navy, gray600, gray500, gray400, gray200, gray100, gray50, border, danger, dangerBg, success, successBg, warning, warningBg, info, infoBg, purple, bg } = theme

const FIELD_TYPES = ['text', 'long text', 'number', 'date', 'choice']

const DATE_RANGES = [
  ['all', 'All time'],
  ['today', 'Today'],
  ['week', 'This week'],
  ['lastweek', 'Last week'],
  ['month', 'This month'],
  ['year', 'This year'],
  ['custom', 'Custom'],
]

function fmtStamp(d) {
  if (!d) return ''
  return new Date(d).toLocaleString('en-NG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function timeAgo(d) {
  if (!d) return ''
  const diff = Math.floor((Date.now() - new Date(d)) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago'
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago'
  return Math.floor(diff / 86400) + 'd ago'
}

function readAuth() {
  try { return JSON.parse(localStorage.getItem('carehub_auth') || '{}') } catch (e) { return {} }
}

// iPhone Safari cannot record webm. Pick whatever this browser actually supports.
function pickAudioType() {
  if (typeof MediaRecorder === 'undefined') return null
  const candidates = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/aac', 'audio/ogg']
  for (let i = 0; i < candidates.length; i++) {
    try {
      if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(candidates[i])) {
        return candidates[i]
      }
    } catch (e) {}
  }
  return ''
}

function startOfWeek(d) {
  const x = new Date(d)
  const day = x.getDay()
  const diff = day === 0 ? 6 : day - 1
  x.setDate(x.getDate() - diff)
  x.setHours(0, 0, 0, 0)
  return x
}

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v)
  return '"' + s.replace(/"/g, '""') + '"'
}

export default function LiveActivity({ brand }) {
  const { msg, type, actionLabel, onAction, show: showToast } = useToast()
  const authData = readAuth()
  const meStaffId = (authData && authData.staff && authData.staff.id) ? authData.staff.id : null
  const meName = (authData && authData.staff && authData.staff.full_name)
    ? authData.staff.full_name
    : ((authData && authData.brand && authData.brand.owner) ? authData.brand.owner : 'Owner')
  const meTitle = (authData && authData.staff)
    ? (authData.staff.public_title || authData.staff.role || 'Staff')
    : 'Owner'
  const isOwner = meStaffId === null

  const [fields, setFields] = useState([])
  const [activities, setActivities] = useState([])
  const [viewersByAct, setViewersByAct] = useState({})
  const [reactionsByAct, setReactionsByAct] = useState({})
  const [commentsByAct, setCommentsByAct] = useState({})
  const [staffList, setStaffList] = useState([])
  const [territories, setTerritories] = useState([])
  const [myViewers, setMyViewers] = useState([])
  const [loading, setLoading] = useState(true)
  const [liveOn, setLiveOn] = useState(false)

  const [view, setView] = useState('feed')
  const [dateRange, setDateRange] = useState('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [filterRep, setFilterRep] = useState('all')
  const [filterTerr, setFilterTerr] = useState('all')
  const [hiddenCols, setHiddenCols] = useState({})
  const [pickingCols, setPickingCols] = useState(false)

  const [logging, setLogging] = useState(false)
  const [values, setValues] = useState({})
  const [terrId, setTerrId] = useState('')
  const [overrideViewers, setOverrideViewers] = useState(null)
  const [voiceBlob, setVoiceBlob] = useState(null)
  const [voicePreview, setVoicePreview] = useState(null)
  const [recording, setRecording] = useState(false)
  const [gps, setGps] = useState(null)
  const [placeName, setPlaceName] = useState('')
  const [findingPlace, setFindingPlace] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState('')

  const [settingUp, setSettingUp] = useState(false)
  const [newField, setNewField] = useState({ label: '', field_type: 'text', required: false, options: '' })
  const [fieldToRemove, setFieldToRemove] = useState(null)

  const [pickingViewers, setPickingViewers] = useState(false)
  const [viewerDraft, setViewerDraft] = useState([])

  const [commentDrafts, setCommentDrafts] = useState({})
  const [openComments, setOpenComments] = useState({})

  const recorderRef = useRef(null)
  const chunksRef = useRef([])
  const mimeRef = useRef('')

  useEffect(() => { load() }, [brand?.id])

  useEffect(() => {
    if (!brand || !brand.id) return
    const stop = watchTable('field_activities', brand.id, function (row) {
      setActivities(function (prev) {
        if (prev.some(function (a) { return a.id === row.id })) return prev
        return [row].concat(prev)
      })
      setLiveOn(true)
    })
    setLiveOn(true)
    return function () {
      stop()
      setLiveOn(false)
    }
  }, [brand?.id])

  async function load() {
    if (!brand || !brand.id) return
    setLoading(true)
    try {
      const flds = await getActivityFields(brand.id)
      const acts = await getFieldActivities(brand.id)
      const stf = await staffRepository.getAll(brand.id)
      const ters = await territoryRepository.getAll(brand.id)
      setFields(flds || [])
      setActivities(acts || [])
      setStaffList(stf || [])
      setTerritories(ters || [])

      const ids = (acts || []).map(function (a) { return a.id })
      const vs = await getActivityViewers(ids)
      const vmap = {}
      ;(vs || []).forEach(function (v) {
        if (!vmap[v.activity_id]) vmap[v.activity_id] = []
        vmap[v.activity_id].push(v)
      })
      setViewersByAct(vmap)

      const rs = await getActivityReactions(ids)
      const rmap = {}
      ;(rs || []).forEach(function (r) {
        if (!rmap[r.activity_id]) rmap[r.activity_id] = []
        rmap[r.activity_id].push(r)
      })
      setReactionsByAct(rmap)

      const cs = await getActivityComments(ids)
      const cmap = {}
      ;(cs || []).forEach(function (c) {
        if (!cmap[c.activity_id]) cmap[c.activity_id] = []
        cmap[c.activity_id].push(c)
      })
      setCommentsByAct(cmap)

      if (meStaffId) {
        const dv = await getDefaultViewers(meStaffId)
        setMyViewers(dv || [])
      }
    } catch (e) {
      showToast('Could not load activity: ' + e.message, { type: 'error' })
    }
    setLoading(false)
  }

  const people = staffList
    .map(function (s) { return { id: s.id, name: s.full_name, title: s.public_title || s.role } })
    .filter(function (p) { return p.id !== meStaffId })

  function nameFor(id) {
    const found = people.filter(function (p) { return p.id === id })[0]
    return found ? found.name : 'Unknown'
  }

  async function saveField() {
    if (!newField.label.trim()) { showToast('Give the field a name.', { type: 'warning' }); return }
    try {
      await addActivityField({
        business_id: brand.id,
        label: newField.label.trim(),
        field_type: newField.field_type,
        required: newField.required,
        options: newField.field_type === 'choice' ? (newField.options || null) : null,
        sort_order: fields.length,
      })
      showToast('Field added', { type: 'success' })
      setNewField({ label: '', field_type: 'text', required: false, options: '' })
      load()
    } catch (e) {
      showToast('Could not add field: ' + e.message, { type: 'error' })
    }
  }

  function askRemoveField(f) { setFieldToRemove(f) }

  async function removeField() {
    if (!fieldToRemove) return
    try {
      await deleteActivityField(fieldToRemove.id)
      setFieldToRemove(null)
      showToast('Field removed', { type: 'success' })
      load()
    } catch (e) {
      showToast('Could not remove: ' + e.message, { type: 'error' })
    }
  }

  function openViewerPicker() {
    setViewerDraft(myViewers.map(function (v) { return v.viewer_staff_id }))
    setPickingViewers(true)
  }

  function toggleViewerDraft(id) {
    setViewerDraft(function (prev) {
      return prev.indexOf(id) >= 0 ? prev.filter(function (x) { return x !== id }) : prev.concat([id])
    })
  }

  async function saveViewers() {
    try {
      const viewers = viewerDraft.map(function (id) {
        return { viewer_staff_id: id, viewer_name: nameFor(id) }
      })
      await setDefaultViewers(brand.id, meStaffId, viewers)
      showToast('Saved — these people see your activity by default', { type: 'success' })
      setPickingViewers(false)
      load()
    } catch (e) {
      showToast('Could not save: ' + e.message, { type: 'error' })
    }
  }

  async function startRecording() {
    if (typeof MediaRecorder === 'undefined') {
      showToast('This browser cannot record audio.', { type: 'error' })
      return
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showToast('This browser will not give access to the microphone.', { type: 'error' })
      return
    }

    let stream = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e) {
      showToast('Microphone blocked: ' + (e.message || e.name) + '. Allow microphone access for this site, then try again.', { type: 'error' })
      return
    }

    try {
      const mime = pickAudioType()
      mimeRef.current = mime || ''
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)

      chunksRef.current = []
      rec.ondataavailable = function (e) {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
      }
      rec.onerror = function (e) {
        showToast('Recording error: ' + ((e && e.error && e.error.message) || 'unknown'), { type: 'error' })
        setRecording(false)
        try { stream.getTracks().forEach(function (t) { t.stop() }) } catch (x) {}
      }
      rec.onstop = function () {
        try {
          const type = mimeRef.current || 'audio/mp4'
          const blob = new Blob(chunksRef.current, { type: type })
          if (blob.size === 0) {
            showToast('Nothing was recorded. Hold the button a little longer.', { type: 'warning' })
          } else {
            setVoiceBlob(blob)
            setVoicePreview(URL.createObjectURL(blob))
          }
        } catch (e) {
          showToast('Could not finish the recording: ' + e.message, { type: 'error' })
        }
        try { stream.getTracks().forEach(function (t) { t.stop() }) } catch (x) {}
      }

      recorderRef.current = rec
      rec.start()
      setRecording(true)
    } catch (e) {
      showToast('Could not start recording: ' + (e.message || e.name), { type: 'error' })
      try { stream.getTracks().forEach(function (t) { t.stop() }) } catch (x) {}
      setRecording(false)
    }
  }

  function stopRecording() {
    try {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop()
      }
    } catch (e) {
      showToast('Could not stop cleanly: ' + e.message, { type: 'error' })
    }
    setRecording(false)
  }

  function clearVoice() {
    setVoiceBlob(null)
    setVoicePreview(null)
  }

  function openLogger() {
    if (fields.length === 0) {
      showToast('No activity fields set up yet. The Owner needs to define what a visit record looks like first.', { type: 'warning' })
      return
    }
    setValues({})
    setTerrId('')
    setOverrideViewers(null)
    setVoiceBlob(null)
    setVoicePreview(null)
    setGps(null)
    setPlaceName('')
    setLogging(true)

    if (navigator.geolocation) {
      setFindingPlace(true)
      navigator.geolocation.getCurrentPosition(
        async function (pos) {
          const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude }
          setGps(coords)
          const name = await reverseGeocode(coords.lat, coords.lng)
          if (name) setPlaceName(name)
          setFindingPlace(false)
        },
        function () { setFindingPlace(false) },
        { enableHighAccuracy: true, timeout: 10000 }
      )
    }
  }

  async function submitActivity() {
    const missing = fields.filter(function (f) { return f.required && !values[f.id] })
    if (missing.length > 0) {
      showToast('Please fill in: ' + missing.map(function (f) { return f.label }).join(', '), { type: 'warning' })
      return
    }

    setSaving(true)
    try {
      let voiceUrl = null
      if (voiceBlob) {
        setSaveStatus('Uploading voice note...')
        voiceUrl = await uploadActivityVoice(voiceBlob)
      }
      setSaveStatus('Saving...')

      const chosen = overrideViewers !== null
        ? overrideViewers
        : myViewers.map(function (v) { return v.viewer_staff_id })

      const viewers = chosen.map(function (id) {
        return { staff_id: id, viewer_name: nameFor(id) }
      })

      await logActivity({
        business_id: brand.id,
        staff_id: meStaffId,
        rep_name: meName,
        rep_title: meTitle,
        territory_id: terrId || null,
        values_json: JSON.stringify(values),
        voice_url: voiceUrl,
        lat: gps ? gps.lat : null,
        lng: gps ? gps.lng : null,
        location_label: placeName || null,
      }, viewers)

      showToast('Activity logged', { type: 'success' })
      setLogging(false)
      load()
    } catch (e) {
      showToast('Could not log activity: ' + e.message, { type: 'error' })
    }
    setSaveStatus('')
    setSaving(false)
  }

  function myReaction(actId) {
    const rows = reactionsByAct[actId] || []
    return rows.filter(function (r) { return r.staff_id === meStaffId })[0]
  }

  async function toggleReaction(actId) {
    const existing = myReaction(actId)
    try {
      if (existing) await unreactToActivity(existing.id)
      else await reactToActivity(actId, meStaffId, meName)
      load()
    } catch (e) {
      showToast('Could not react: ' + e.message, { type: 'error' })
    }
  }

  // Passes the rep's id so they get notified when a manager replies to them.
  async function postComment(actId) {
    const text = (commentDrafts[actId] || '').trim()
    if (!text) return
    const act = activities.filter(function (a) { return a.id === actId })[0]
    try {
      await commentOnActivity({
        activity_id: actId,
        staff_id: meStaffId,
        actor_name: meName,
        actor_title: meTitle,
        body: text,
      }, brand.id, act ? act.staff_id : null)
      setCommentDrafts(function (prev) {
        const next = { ...prev }
        next[actId] = ''
        return next
      })
      load()
    } catch (e) {
      showToast('Could not comment: ' + e.message, { type: 'error' })
    }
  }

  function inRange(dateStr) {
    if (dateRange === 'all') return true
    const d = new Date(dateStr)
    const now = new Date()

    if (dateRange === 'today') {
      const start = new Date()
      start.setHours(0, 0, 0, 0)
      return d >= start
    }
    if (dateRange === 'week') return d >= startOfWeek(now)
    if (dateRange === 'lastweek') {
      const thisWeek = startOfWeek(now)
      const lastWeek = new Date(thisWeek)
      lastWeek.setDate(lastWeek.getDate() - 7)
      return d >= lastWeek && d < thisWeek
    }
    if (dateRange === 'month') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1)
      return d >= start
    }
    if (dateRange === 'year') {
      const start = new Date(now.getFullYear(), 0, 1)
      return d >= start
    }
    if (dateRange === 'custom') {
      if (customFrom) {
        const from = new Date(customFrom)
        from.setHours(0, 0, 0, 0)
        if (d < from) return false
      }
      if (customTo) {
        const to = new Date(customTo)
        to.setHours(23, 59, 59, 999)
        if (d > to) return false
      }
      return true
    }
    return true
  }

  const permitted = activities.filter(function (a) {
    if (isOwner) return true
    if (a.staff_id === meStaffId) return true
    const vs = viewersByAct[a.id] || []
    return vs.some(function (v) { return v.staff_id === meStaffId })
  })

  const visible = permitted.filter(function (a) {
    if (!inRange(a.created_at)) return false
    if (filterRep !== 'all' && a.staff_id !== filterRep) return false
    if (filterTerr !== 'all' && a.territory_id !== filterTerr) return false
    return true
  })

  function terrName(id) {
    const t = territories.filter(function (x) { return x.id === id })[0]
    return t ? t.name : null
  }

  function parseValues(json) {
    try { return JSON.parse(json || '{}') } catch (e) { return {} }
  }

  function labelFor(fieldId) {
    const f = fields.filter(function (x) { return x.id === fieldId })[0]
    return f ? f.label : null
  }

  const columns = [
    { key: 'date', label: 'Date' },
    { key: 'rep', label: 'Rep' },
    { key: 'territory', label: 'Territory' },
    { key: 'place', label: 'Location' },
  ].concat(fields.map(function (f) {
    return { key: 'f_' + f.id, label: f.label, fieldId: f.id }
  })).concat([
    { key: 'voice', label: 'Voice' },
    { key: 'coords', label: 'Map' },
  ])

  const shownColumns = columns.filter(function (c) { return !hiddenCols[c.key] })

  function cellValue(a, col) {
    if (col.key === 'date') return fmtStamp(a.created_at)
    if (col.key === 'rep') return a.rep_name
    if (col.key === 'territory') return terrName(a.territory_id) || ''
    if (col.key === 'place') return a.location_label || ''
    if (col.key === 'voice') return a.voice_url ? 'Yes' : ''
    if (col.key === 'coords') return (a.lat && a.lng) ? (a.lat.toFixed(5) + ', ' + a.lng.toFixed(5)) : ''
    if (col.fieldId) {
      const vals = parseValues(a.values_json)
      return vals[col.fieldId] || ''
    }
    return ''
  }

  function toggleCol(key) {
    setHiddenCols(function (prev) {
      const next = { ...prev }
      if (next[key]) delete next[key]
      else next[key] = true
      return next
    })
  }

  function rangeLabel() {
    const found = DATE_RANGES.filter(function (r) { return r[0] === dateRange })[0]
    return found ? found[1] : 'All time'
  }

  function exportCSV() {
    if (visible.length === 0) {
      showToast('Nothing to export with the current filters.', { type: 'warning' })
      return
    }
    try {
      const header = shownColumns.map(function (c) { return csvCell(c.label) }).join(',')
      const rows = visible.map(function (a) {
        return shownColumns.map(function (c) { return csvCell(cellValue(a, c)) }).join(',')
      })
      const csv = [header].concat(rows).join('\n')

      const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')

      const repPart = filterRep === 'all' ? 'all-reps' : (nameFor(filterRep) || 'rep').replace(/\s+/g, '-').toLowerCase()
      const datePart = rangeLabel().replace(/\s+/g, '-').toLowerCase()
      a.href = url
      a.download = 'field-activity-' + repPart + '-' + datePart + '.csv'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      showToast('Exported ' + visible.length + ' record' + (visible.length > 1 ? 's' : ''), { type: 'success' })
    } catch (e) {
      showToast('Could not export: ' + e.message, { type: 'error' })
    }
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
      <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '18px', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ fontSize: '18px', fontWeight: '900', color: navy }}>Live Field Activity</div>
            {liveOn && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '10px', fontWeight: '800', color: danger, background: dangerBg, padding: '3px 9px', borderRadius: '20px', border: `1px solid ${danger}` }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: danger }} />
                LIVE
              </span>
            )}
          </div>
          <div style={{ fontSize: '13px', color: gray500, marginTop: '2px' }}>
            Reps log what happens in the field. Tagged managers see it the moment it lands — and can reply.
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {isOwner && (
            <GhostBtn onClick={function () { setSettingUp(true) }} style={{ padding: '10px 14px' }}>Set up fields</GhostBtn>
          )}
          {!isOwner && (
            <GhostBtn onClick={openViewerPicker} style={{ padding: '10px 14px' }}>Who sees my activity</GhostBtn>
          )}
          <TealBtn onClick={openLogger}>+ Log Activity</TealBtn>
        </div>
      </div>

      {!isOwner && myViewers.length === 0 && (
        <div style={{ padding: '12px 14px', borderRadius: '10px', background: warningBg, border: `1px solid ${warning}`, marginBottom: '18px' }}>
          <div style={{ fontSize: '13px', fontWeight: '800', color: warning }}>Nobody is seeing your activity yet</div>
          <div style={{ fontSize: '12px', color: warning, marginTop: '2px' }}>
            Tap "Who sees my activity" and pick your managers.
          </div>
        </div>
      )}

      {isOwner && fields.length === 0 && (
        <div style={{ padding: '12px 14px', borderRadius: '10px', background: warningBg, border: `1px solid ${warning}`, marginBottom: '18px' }}>
          <div style={{ fontSize: '13px', fontWeight: '800', color: warning }}>No activity fields set up yet</div>
          <div style={{ fontSize: '12px', color: warning, marginTop: '2px' }}>
            Tap "Set up fields" and decide what a visit record should capture.
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
        {[['feed', 'Feed'], ['table', 'Table']].map(function (v) {
          const on = view === v[0]
          return (
            <button key={v[0]} onClick={function () { setView(v[0]) }}
              style={{ fontSize: '12.5px', fontWeight: '800', padding: '9px 18px', borderRadius: '10px', cursor: 'pointer',
                border: `1px solid ${on ? tealDeep : border}`,
                background: on ? navy : 'white',
                color: on ? 'white' : gray500 }}>
              {v[1]}
            </button>
          )
        })}
      </div>

      <Card style={{ padding: '14px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
          {DATE_RANGES.map(function (r) {
            const on = dateRange === r[0]
            return (
              <button key={r[0]} onClick={function () { setDateRange(r[0]) }}
                style={{ fontSize: '11.5px', fontWeight: '700', padding: '7px 12px', borderRadius: '20px', cursor: 'pointer',
                  border: `1px solid ${on ? tealDeep : border}`,
                  background: on ? tealDeep : 'white',
                  color: on ? 'white' : gray500 }}>
                {r[1]}
              </button>
            )
          })}
        </div>

        {dateRange === 'custom' && (
          <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '11px', fontWeight: '700', color: gray500, marginBottom: '4px' }}>From</div>
              <input type='date' value={customFrom} onChange={function (e) { setCustomFrom(e.target.value) }}
                style={{ width: '100%', padding: '9px 10px', borderRadius: '8px', border: `1px solid ${border}`, fontSize: '12.5px', boxSizing: 'border-box' }} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '11px', fontWeight: '700', color: gray500, marginBottom: '4px' }}>To</div>
              <input type='date' value={customTo} onChange={function (e) { setCustomTo(e.target.value) }}
                style={{ width: '100%', padding: '9px 10px', borderRadius: '8px', border: `1px solid ${border}`, fontSize: '12.5px', boxSizing: 'border-box' }} />
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: '150px' }}>
            <div style={{ fontSize: '11px', fontWeight: '700', color: gray500, marginBottom: '4px' }}>Rep</div>
            <select value={filterRep} onChange={function (e) { setFilterRep(e.target.value) }}
              style={{ width: '100%', padding: '9px 10px', borderRadius: '8px', border: `1px solid ${border}`, fontSize: '12.5px', background: 'white' }}>
              <option value='all'>All reps</option>
              {staffList.map(function (s) { return <option key={s.id} value={s.id}>{s.full_name}</option> })}
            </select>
          </div>

          <div style={{ flex: 1, minWidth: '150px' }}>
            <div style={{ fontSize: '11px', fontWeight: '700', color: gray500, marginBottom: '4px' }}>Territory</div>
            <select value={filterTerr} onChange={function (e) { setFilterTerr(e.target.value) }}
              style={{ width: '100%', padding: '9px 10px', borderRadius: '8px', border: `1px solid ${border}`, fontSize: '12.5px', background: 'white' }}>
              <option value='all'>All territories</option>
              {territories.map(function (t) { return <option key={t.id} value={t.id}>{t.name}</option> })}
            </select>
          </div>

          {view === 'table' && (
            <button onClick={function () { setPickingCols(true) }}
              style={{ flexShrink: 0, border: `1px solid ${border}`, background: 'white', color: gray600, borderRadius: '8px', padding: '10px 14px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}>
              Columns
            </button>
          )}

          <button onClick={exportCSV}
            style={{ flexShrink: 0, border: 'none', background: navy, color: 'white', borderRadius: '8px', padding: '10px 16px', fontSize: '12px', fontWeight: '800', cursor: 'pointer' }}>
            Export
          </button>
        </div>

        <div style={{ fontSize: '11.5px', color: gray400, marginTop: '10px' }}>
          Showing <strong style={{ color: navy }}>{visible.length}</strong> record{visible.length !== 1 ? 's' : ''} — {rangeLabel()}
          {filterRep !== 'all' ? ' · ' + nameFor(filterRep) : ''}
          . Export downloads exactly what you see here, as a spreadsheet.
        </div>
      </Card>

      {loading && <Loading />}

      {!loading && visible.length === 0 && (
        <Card style={{ padding: '32px', textAlign: 'center' }}>
          <div style={{ fontWeight: '800', color: navy, marginBottom: '6px' }}>
            {permitted.length === 0 ? 'Nothing logged yet' : 'Nothing matches those filters'}
          </div>
          <div style={{ fontSize: '13px', color: gray500, marginBottom: '16px' }}>
            {permitted.length === 0 ? 'When a rep logs a visit, it appears here instantly.' : 'Try a wider date range.'}
          </div>
          {permitted.length === 0 && <TealBtn onClick={openLogger}>+ Log Activity</TealBtn>}
        </Card>
      )}

      {view === 'table' && visible.length > 0 && (
        <Card style={{ padding: '0', overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
              <thead>
                <tr style={{ background: bg }}>
                  {shownColumns.map(function (c) {
                    return (
                      <th key={c.key} style={{ textAlign: 'left', padding: '12px 14px', fontSize: '10.5px', fontWeight: '800', color: gray500, textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: `1px solid ${border}`, whiteSpace: 'nowrap' }}>
                        {c.label}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {visible.map(function (a, i) {
                  return (
                    <tr key={a.id} style={{ background: i % 2 === 0 ? 'white' : bg }}>
                      {shownColumns.map(function (c) {
                        const val = cellValue(a, c)
                        if (c.key === 'voice' && a.voice_url) {
                          return (
                            <td key={c.key} style={{ padding: '10px 14px', borderBottom: `1px solid ${gray100}` }}>
                              <audio src={a.voice_url} controls preload='none' style={{ height: '30px', maxWidth: '160px' }} />
                            </td>
                          )
                        }
                        if (c.key === 'coords' && a.lat && a.lng) {
                          return (
                            <td key={c.key} style={{ padding: '10px 14px', borderBottom: `1px solid ${gray100}`, whiteSpace: 'nowrap' }}>
                              <a href={'https://www.google.com/maps?q=' + a.lat + ',' + a.lng} target='_blank' rel='noreferrer'
                                style={{ fontSize: '11.5px', fontWeight: '700', color: tealDeep, textDecoration: 'none' }}>
                                View map
                              </a>
                            </td>
                          )
                        }
                        return (
                          <td key={c.key} style={{ padding: '10px 14px', borderBottom: `1px solid ${gray100}`, color: navy, verticalAlign: 'top' }}>
                            {val || <span style={{ color: gray400 }}>—</span>}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {view === 'feed' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {visible.map(function (a) {
            const vals = parseValues(a.values_json)
            const reactions = reactionsByAct[a.id] || []
            const comments = commentsByAct[a.id] || []
            const viewers = viewersByAct[a.id] || []
            const iReacted = !!myReaction(a.id)
            const commentsOpen = !!openComments[a.id]

            return (
              <Card key={a.id} style={{ padding: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: '14.5px', fontWeight: '800', color: navy }}>{a.rep_name}</div>
                    {a.rep_title && <div style={{ fontSize: '11.5px', color: tealDeep, fontWeight: '700' }}>{a.rep_title}</div>}
                    <div style={{ fontSize: '11px', color: gray400, marginTop: '3px' }}>
                      {timeAgo(a.created_at)} · {fmtStamp(a.created_at)}
                      {terrName(a.territory_id) ? ' · ' + terrName(a.territory_id) : ''}
                    </div>
                    {a.location_label && (
                      <div style={{ fontSize: '12px', color: tealDeep, fontWeight: '600', marginTop: '4px' }}>
                        {a.location_label}
                      </div>
                    )}
                  </div>
                  {a.lat && a.lng && (
                    <a href={'https://www.google.com/maps?q=' + a.lat + ',' + a.lng} target='_blank' rel='noreferrer'
                      style={{ flexShrink: 0, fontSize: '11px', fontWeight: '700', color: tealDeep, background: tealMist, border: `1px solid ${tealMist}`, borderRadius: '20px', padding: '5px 11px', textDecoration: 'none' }}>
                      View on map
                    </a>
                  )}
                </div>

                <div style={{ marginTop: '12px', background: bg, borderRadius: '10px', padding: '12px' }}>
                  {Object.keys(vals).length === 0 && (
                    <div style={{ fontSize: '12px', color: gray400 }}>No details entered.</div>
                  )}
                  {Object.keys(vals).map(function (fid) {
                    const label = labelFor(fid)
                    if (!label || !vals[fid]) return null
                    return (
                      <div key={fid} style={{ marginBottom: '8px' }}>
                        <div style={{ fontSize: '10px', fontWeight: '800', color: gray400, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
                        <div style={{ fontSize: '13px', color: navy, marginTop: '2px', whiteSpace: 'pre-wrap' }}>{vals[fid]}</div>
                      </div>
                    )
                  })}
                </div>

                {a.voice_url && (
                  <div style={{ marginTop: '10px' }}>
                    <div style={{ fontSize: '10px', fontWeight: '800', color: gray400, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '5px' }}>Voice note</div>
                    <audio src={a.voice_url} controls preload='none' style={{ width: '100%', height: '38px' }} />
                  </div>
                )}

                {viewers.length > 0 && (
                  <div style={{ fontSize: '11px', color: gray400, marginTop: '10px' }}>
                    Seen by: {viewers.map(function (v) { return v.viewer_name }).join(', ')}
                  </div>
                )}

                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '12px', paddingTop: '12px', borderTop: `1px solid ${gray100}`, flexWrap: 'wrap' }}>
                  <button onClick={function () { toggleReaction(a.id) }}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', border: `1px solid ${iReacted ? tealDeep : border}`,
                      background: iReacted ? tealMist : 'white', color: iReacted ? tealDeep : gray500,
                      borderRadius: '20px', padding: '6px 13px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}>
                    {iReacted ? 'Acknowledged' : 'Acknowledge'}
                    {reactions.length > 0 ? ' · ' + reactions.length : ''}
                  </button>

                  <button onClick={function () {
                    setOpenComments(function (prev) {
                      const next = { ...prev }
                      next[a.id] = !prev[a.id]
                      return next
                    })
                  }}
                    style={{ border: `1px solid ${border}`, background: 'white', color: gray500, borderRadius: '20px', padding: '6px 13px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}>
                    Comment{comments.length > 0 ? ' · ' + comments.length : ''}
                  </button>
                </div>

                {reactions.length > 0 && (
                  <div style={{ fontSize: '11px', color: tealDeep, marginTop: '8px', fontWeight: '600' }}>
                    {reactions.map(function (r) { return r.actor_name }).join(', ')} acknowledged this
                  </div>
                )}

                {commentsOpen && (
                  <div style={{ marginTop: '12px' }}>
                    {comments.map(function (c) {
                      return (
                        <div key={c.id} style={{ background: bg, borderRadius: '10px', padding: '10px 12px', marginBottom: '6px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                            <span style={{ fontSize: '12px', fontWeight: '800', color: navy }}>
                              {c.actor_name}{c.actor_title ? ' · ' + c.actor_title : ''}
                            </span>
                            <span style={{ fontSize: '10px', color: gray400, flexShrink: 0 }}>{timeAgo(c.created_at)}</span>
                          </div>
                          <div style={{ fontSize: '13px', color: gray600, marginTop: '3px', lineHeight: '1.5' }}>{c.body}</div>
                        </div>
                      )
                    })}

                    <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                      <input value={commentDrafts[a.id] || ''}
                        onChange={function (e) {
                          const v = e.target.value
                          setCommentDrafts(function (prev) {
                            const next = { ...prev }
                            next[a.id] = v
                            return next
                          })
                        }}
                        onKeyDown={function (e) { if (e.key === 'Enter') postComment(a.id) }}
                        placeholder='Reply to the rep...'
                        style={{ flex: 1, padding: '10px 12px', borderRadius: '20px', border: `1px solid ${border}`, fontSize: '13px', outline: 'none' }} />
                      <button onClick={function () { postComment(a.id) }}
                        style={{ flexShrink: 0, background: tealDeep, color: 'white', border: 'none', borderRadius: '20px', padding: '10px 16px', fontSize: '12px', fontWeight: '800', cursor: 'pointer' }}>
                        Send
                      </button>
                    </div>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      <Modal show={pickingCols} onClose={function () { setPickingCols(false) }} sheet title='Columns'
        footer={<GhostBtn onClick={function () { setPickingCols(false) }} style={{ width: '100%', padding: '13px' }}>Done</GhostBtn>}>
            <div style={{ fontSize: '11.5px', color: gray500, marginBottom: '16px' }}>
              Tick what you want to see. The export matches exactly this.
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {columns.map(function (c) {
                const on = !hiddenCols[c.key]
                return (
                  <button key={c.key} onClick={function () { toggleCol(c.key) }}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', borderRadius: '10px', cursor: 'pointer', textAlign: 'left',
                      border: `1px solid ${on ? tealDeep : border}`,
                      background: on ? tealMist : 'white' }}>
                    <span style={{ fontSize: '13px', fontWeight: '700', color: navy }}>{c.label}</span>
                    <span style={{ fontSize: '11.5px', fontWeight: '800', color: on ? tealDeep : gray400 }}>
                      {on ? 'Shown' : 'Hidden'}
                    </span>
                  </button>
                )
              })}
            </div>
      </Modal>

      <Modal show={logging} onClose={function () { setLogging(false) }} sheet wide title='Log Activity'
        footer={<>
          <GhostBtn onClick={function () { setLogging(false) }} style={{ flex: 1, padding: '13px' }}>Cancel</GhostBtn>
          <TealBtn onClick={submitActivity} style={{ flex: 2, padding: '13px' }}>{saving ? 'Saving...' : 'Log It'}</TealBtn>
        </>}>
            <div style={{ padding: '10px 12px', borderRadius: '8px', background: placeName ? tealMist : bg, border: '1px solid ' + (placeName ? tealMist : gray100), marginBottom: '16px' }}>
              <div style={{ fontSize: '10px', fontWeight: '800', color: gray400, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Location</div>
              <div style={{ fontSize: '12.5px', color: placeName ? tealDeep : gray400, fontWeight: placeName ? '700' : '500', marginTop: '2px' }}>
                {placeName
                  ? placeName
                  : findingPlace
                    ? 'Finding where you are...'
                    : gps
                      ? 'Coordinates captured'
                      : 'Location not available'}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <div style={{ fontSize: '12px', fontWeight: '700', color: gray600, marginBottom: '6px' }}>Territory</div>
                <select value={terrId} onChange={function (e) { setTerrId(e.target.value) }}
                  style={{ width: '100%', padding: '11px 12px', borderRadius: '10px', border: `1px solid ${border}`, fontSize: '13px', background: 'white' }}>
                  <option value=''>Not set</option>
                  {territories.map(function (t) { return <option key={t.id} value={t.id}>{t.name}</option> })}
                </select>
              </div>

              {fields.map(function (f) {
                const val = values[f.id] || ''
                const set = function (v) {
                  setValues(function (prev) {
                    const next = { ...prev }
                    next[f.id] = v
                    return next
                  })
                }
                return (
                  <div key={f.id}>
                    <div style={{ fontSize: '12px', fontWeight: '700', color: gray600, marginBottom: '6px' }}>
                      {f.label}{f.required ? ' *' : ''}
                    </div>

                    {f.field_type === 'long text' && (
                      <textarea value={val} onChange={function (e) { set(e.target.value) }} rows={4}
                        style={{ width: '100%', padding: '11px 12px', borderRadius: '10px', border: `1px solid ${border}`, fontSize: '13px', fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }} />
                    )}

                    {f.field_type === 'choice' && (
                      <select value={val} onChange={function (e) { set(e.target.value) }}
                        style={{ width: '100%', padding: '11px 12px', borderRadius: '10px', border: `1px solid ${border}`, fontSize: '13px', background: 'white' }}>
                        <option value=''>Choose...</option>
                        {(f.options || '').split(',').map(function (opt) {
                          const t = opt.trim()
                          if (!t) return null
                          return <option key={t} value={t}>{t}</option>
                        })}
                      </select>
                    )}

                    {(f.field_type === 'text' || f.field_type === 'number' || f.field_type === 'date') && (
                      <input
                        type={f.field_type === 'number' ? 'number' : f.field_type === 'date' ? 'date' : 'text'}
                        value={val} onChange={function (e) { set(e.target.value) }}
                        style={{ width: '100%', padding: '11px 12px', borderRadius: '10px', border: `1px solid ${border}`, fontSize: '13px', boxSizing: 'border-box' }} />
                    )}
                  </div>
                )
              })}

              <div>
                <div style={{ fontSize: '12px', fontWeight: '700', color: gray600, marginBottom: '2px' }}>Voice note</div>
                <div style={{ fontSize: '11px', color: gray400, marginBottom: '8px' }}>
                  Faster than typing. Say what happened — your managers can play it back.
                </div>

                {!voicePreview && !recording && (
                  <button type='button' onClick={startRecording}
                    style={{ width: '100%', border: `1px dashed ${tealDeep}`, background: bg, color: tealDeep, borderRadius: '10px', padding: '14px', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}>
                    Start recording
                  </button>
                )}

                {recording && (
                  <button type='button' onClick={stopRecording}
                    style={{ width: '100%', border: 'none', background: danger, color: 'white', borderRadius: '10px', padding: '14px', fontSize: '13px', fontWeight: '800', cursor: 'pointer' }}>
                    ● Recording — tap to stop
                  </button>
                )}

                {voicePreview && (
                  <div>
                    <audio src={voicePreview} controls style={{ width: '100%', height: '38px' }} />
                    <button type='button' onClick={clearVoice}
                      style={{ marginTop: '6px', border: `1px solid ${danger}`, background: dangerBg, color: danger, borderRadius: '8px', padding: '7px 12px', fontSize: '11.5px', fontWeight: '700', cursor: 'pointer' }}>
                      Remove voice note
                    </button>
                  </div>
                )}
              </div>

              {!isOwner && (
                <div style={{ padding: '12px', borderRadius: '10px', border: `1px solid ${border}`, background: bg }}>
                  <div style={{ fontSize: '12px', fontWeight: '700', color: gray600, marginBottom: '6px' }}>Who sees this</div>
                  {overrideViewers === null ? (
                    <div>
                      <div style={{ fontSize: '12px', color: gray500 }}>
                        {myViewers.length > 0
                          ? myViewers.map(function (v) { return v.viewer_name }).join(', ')
                          : 'Nobody — set your default viewers first.'}
                      </div>
                      {people.length > 0 && (
                        <button type='button'
                          onClick={function () { setOverrideViewers(myViewers.map(function (v) { return v.viewer_staff_id })) }}
                          style={{ marginTop: '8px', background: 'none', border: 'none', color: tealDeep, fontSize: '11.5px', fontWeight: '700', cursor: 'pointer', padding: 0 }}>
                          Change just for this one
                        </button>
                      )}
                    </div>
                  ) : (
                    <div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {people.map(function (p) {
                          const on = overrideViewers.indexOf(p.id) >= 0
                          return (
                            <button key={p.id} type='button'
                              onClick={function () {
                                setOverrideViewers(function (prev) {
                                  return prev.indexOf(p.id) >= 0
                                    ? prev.filter(function (x) { return x !== p.id })
                                    : prev.concat([p.id])
                                })
                              }}
                              style={{ fontSize: '11.5px', fontWeight: '600', padding: '7px 11px', borderRadius: '8px', cursor: 'pointer',
                                border: `1px solid ${on ? tealDeep : border}`,
                                background: on ? tealDeep : 'white',
                                color: on ? 'white' : gray600 }}>
                              {p.name}
                            </button>
                          )
                        })}
                      </div>
                      <button type='button' onClick={function () { setOverrideViewers(null) }}
                        style={{ marginTop: '8px', background: 'none', border: 'none', color: gray400, fontSize: '11.5px', fontWeight: '700', cursor: 'pointer', padding: 0 }}>
                        Use my default list instead
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {saveStatus && (
              <div style={{ marginTop: '14px', padding: '9px 11px', borderRadius: '8px', background: tealMist, border: `1px solid ${tealMist}`, fontSize: '12px', color: tealDeep, fontWeight: '600' }}>
                {saveStatus}
              </div>
            )}
      </Modal>

      <Modal show={settingUp} onClose={function () { setSettingUp(false) }} sheet wide title='Activity Fields'
        footer={<GhostBtn onClick={function () { setSettingUp(false) }} style={{ width: '100%', padding: '13px' }}>Done</GhostBtn>}>
            <div style={{ fontSize: '11.5px', color: gray500, marginBottom: '16px' }}>
              Decide what your reps record on every visit. Name them whatever suits your company.
            </div>

            {fields.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '18px' }}>
                {fields.map(function (f) {
                  return (
                    <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', padding: '11px 12px', borderRadius: '10px', border: `1px solid ${border}` }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: '700', color: navy }}>
                          {f.label}{f.required ? ' *' : ''}
                        </div>
                        <div style={{ fontSize: '11px', color: gray400, textTransform: 'capitalize' }}>
                          {f.field_type}{f.options ? ' — ' + f.options : ''}
                        </div>
                      </div>
                      <button onClick={function () { askRemoveField(f) }}
                        style={{ flexShrink: 0, border: `1px solid ${danger}`, background: dangerBg, color: danger, borderRadius: '8px', padding: '6px 10px', fontSize: '11.5px', fontWeight: '700', cursor: 'pointer' }}>
                        Remove
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            <div style={{ padding: '14px', borderRadius: '10px', border: `1px solid ${border}`, background: bg }}>
              <div style={{ fontSize: '12px', fontWeight: '800', color: gray600, marginBottom: '10px' }}>Add a field</div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <input value={newField.label}
                  onChange={function (e) { setNewField({ ...newField, label: e.target.value }) }}
                  placeholder='Field name — e.g. Customer, Products discussed, Outcome'
                  style={{ width: '100%', padding: '11px 12px', borderRadius: '10px', border: `1px solid ${border}`, fontSize: '13px', boxSizing: 'border-box' }} />

                <select value={newField.field_type}
                  onChange={function (e) { setNewField({ ...newField, field_type: e.target.value }) }}
                  style={{ width: '100%', padding: '11px 12px', borderRadius: '10px', border: `1px solid ${border}`, fontSize: '13px', background: 'white', textTransform: 'capitalize' }}>
                  {FIELD_TYPES.map(function (t) { return <option key={t} value={t}>{t}</option> })}
                </select>

                {newField.field_type === 'choice' && (
                  <input value={newField.options}
                    onChange={function (e) { setNewField({ ...newField, options: e.target.value }) }}
                    placeholder='Options, separated by commas — e.g. Sold, Follow-up, No interest'
                    style={{ width: '100%', padding: '11px 12px', borderRadius: '10px', border: `1px solid ${border}`, fontSize: '13px', boxSizing: 'border-box' }} />
                )}

                <label style={{ display: 'flex', alignItems: 'center', gap: '9px', cursor: 'pointer' }}>
                  <input type='checkbox' checked={newField.required}
                    onChange={function (e) { setNewField({ ...newField, required: e.target.checked }) }} />
                  <span style={{ fontSize: '12.5px', color: gray600, fontWeight: '600' }}>Required — the rep must fill this in</span>
                </label>

                <TealBtn onClick={saveField} style={{ width: '100%', padding: '12px' }}>Add Field</TealBtn>
              </div>
            </div>
      </Modal>

      <Modal show={pickingViewers} onClose={function () { setPickingViewers(false) }} sheet title='Who sees my activity'
        footer={<>
          <GhostBtn onClick={function () { setPickingViewers(false) }} style={{ flex: 1, padding: '13px' }}>Cancel</GhostBtn>
          <TealBtn onClick={saveViewers} style={{ flex: 2, padding: '13px' }}>Save</TealBtn>
        </>}>
            <div style={{ fontSize: '11.5px', color: gray500, marginBottom: '16px' }}>
              Set this once. Everything you log goes to these people, live.
            </div>

            {people.length === 0 && <div style={{ fontSize: '13px', color: gray400 }}>No colleagues to pick yet.</div>}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {people.map(function (p) {
                const on = viewerDraft.indexOf(p.id) >= 0
                return (
                  <button key={p.id} onClick={function () { toggleViewerDraft(p.id) }}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', borderRadius: '12px', cursor: 'pointer', textAlign: 'left',
                      border: `1px solid ${on ? tealDeep : border}`,
                      background: on ? tealMist : 'white' }}>
                    <div>
                      <div style={{ fontWeight: '700', fontSize: '13px', color: navy }}>{p.name}</div>
                      <div style={{ fontSize: '11px', color: gray500 }}>{p.title}</div>
                    </div>
                    {on && <span style={{ fontSize: '12px', fontWeight: '800', color: tealDeep }}>Selected</span>}
                  </button>
                )
              })}
            </div>
      </Modal>

      <ConfirmDialog show={!!fieldToRemove} onClose={function () { setFieldToRemove(null) }} onConfirm={removeField}
        title={'Remove "' + (fieldToRemove ? fieldToRemove.label : '') + '"?'}
        consequence="This field disappears from the Log Activity form for everyone. Past records that already have a value for it keep that value, but you will not be able to see or filter by it going forward unless you add the field back."
        confirmLabel="Remove Field" />
    </div>
  )
}
