import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  SQAvatarButton,
  SQAvatarDropdown,
  SQAvatarMenuItem,
} from '../../../../rae-side-quest/packages/sq-ui/index.js'

// Wordy's avatar menu — identity dropdown launched from the avatar button.
// Self-managed open state. Visual chrome lives in sq-ui so all SQ surfaces
// stay aligned (see sq-style-spec.md §5).
export default function AvatarMenu({ profile }) {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()

  return (
    <div className="relative">
      <SQAvatarButton
        profile={profile}
        ariaExpanded={open}
        onClick={() => setOpen((o) => !o)}
      />
      <SQAvatarDropdown
        open={open}
        onClose={() => setOpen(false)}
        profile={profile}
        align="left"
      >
        <SQAvatarMenuItem
          onClick={() => { setOpen(false); navigate('/stats') }}
        >
          📊 Stats
        </SQAvatarMenuItem>
      </SQAvatarDropdown>
    </div>
  )
}
