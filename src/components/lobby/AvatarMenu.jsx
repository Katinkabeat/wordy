import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../../lib/supabase.js'

const AVATAR_HUES = [270, 330, 190, 30, 160, 10]

function getInitials(name) {
  return (name || '?').slice(0, 2).toUpperCase()
}

export default function AvatarMenu({ profile, onProfileUpdate }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const wrapRef = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    function handleKey(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  const hue = profile?.avatar_hue ?? 270
  const name = profile?.username ?? '…'
  const initials = getInitials(name)

  async function handleHueChange(newHue) {
    if (newHue === hue || !profile?.id || saving) return
    const prev = profile
    setSaving(true)
    onProfileUpdate({ ...profile, avatar_hue: newHue })
    const { error } = await supabase
      .from('profiles')
      .update({ avatar_hue: newHue })
      .eq('id', profile.id)
    setSaving(false)
    if (error) {
      onProfileUpdate(prev)
      toast.error(error.message)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <div className="relative" ref={wrapRef}>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-label="Profile and stats"
          aria-haspopup="true"
          aria-expanded={open}
          className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-white text-xs border-2 border-black/5 hover:brightness-110 transition-all"
          style={{ background: `hsl(${hue}, 70%, 55%)` }}
        >
          {initials}
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-2 w-60 bg-white dark:bg-[#1a1130] border border-purple-100 dark:border-[#2d1b55] rounded-xl shadow-lg z-50 py-1">
            <div className="flex items-center gap-2.5 px-3 py-2.5 border-b border-purple-100 dark:border-[#2d1b55]">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-white text-xs"
                style={{ background: `hsl(${hue}, 70%, 55%)` }}
              >
                {initials}
              </div>
              <div className="min-w-0">
                <div className="font-bold text-wordy-700 dark:text-wordy-300 text-sm truncate">{name}</div>
                <div className="text-xs text-wordy-500">Your profile</div>
              </div>
            </div>
            <div className="px-3 py-2.5 border-b border-purple-100 dark:border-[#2d1b55]">
              <div className="text-[0.68rem] uppercase tracking-wide text-wordy-500 mb-2">Avatar color</div>
              <div className="grid grid-cols-6 gap-1.5">
                {AVATAR_HUES.map(h => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => handleHueChange(h)}
                    aria-label={`Hue ${h}`}
                    className={`w-full aspect-square rounded-full border-2 transition-transform ${
                      h === hue ? 'border-wordy-700 dark:border-wordy-300 scale-105' : 'border-transparent'
                    }`}
                    style={{ background: `hsl(${h}, 70%, 55%)` }}
                  />
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={() => { setOpen(false); navigate('/stats') }}
              className="w-full text-left px-3 py-2.5 text-sm hover:bg-wordy-50 dark:hover:bg-[#2d1b55] text-wordy-700 dark:text-wordy-300 transition-colors"
            >
              📊 Stats
            </button>
          </div>
        )}
      </div>
      <span className="text-sm font-bold text-wordy-700 hidden sm:block">
        {name}
      </span>
    </div>
  )
}
