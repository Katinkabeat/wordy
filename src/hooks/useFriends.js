import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase.js'

// Returns the current user's accepted friends as
// [{ id, username, avatar_hue }, …]. Reads the hub's `friendships` +
// `profiles` tables — same data source as the SQ hub's Friends panel,
// no duplication.
export function useFriends(userId) {
  const [friends, setFriends] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const reload = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    try {
      const { data: rows, error: friendErr } = await supabase
        .from('friendships')
        .select('user_a, user_b, status')
        .eq('status', 'accepted')
        .or(`user_a.eq.${userId},user_b.eq.${userId}`)
      if (friendErr) throw friendErr

      const otherIds = (rows ?? []).map(r => r.user_a === userId ? r.user_b : r.user_a)
      if (otherIds.length === 0) {
        setFriends([])
        setLoading(false)
        return
      }

      const { data: profiles, error: profErr } = await supabase
        .from('profiles')
        .select('id, username, avatar_hue')
        .in('id', otherIds)
        .order('username')
      if (profErr) throw profErr

      setFriends(profiles ?? [])
      setError(null)
    } catch (err) {
      console.error('[useFriends] failed', err)
      setError(err)
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => { reload() }, [reload])

  return { friends, loading, error, reload }
}
