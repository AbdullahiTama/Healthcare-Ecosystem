import { supabase } from '../../../config/supabaseClient'

export function createPlaylistRepository({ client = supabase } = {}) {
  return {
    async createPlaylist({ ownerId, title, description }) {
      const { data, error } = await client
        .from('playlists')
        .insert({ owner_id: ownerId, title, description: description || null })
        .select()
        .maybeSingle()
      if (error) throw error
      return data
    },

    async getPlaylistWithOwner(playlistId) {
      const { data, error } = await client
        .from('playlists')
        .select('*, profiles:owner_id(full_name, display_name, is_verified, specialty, verification_label)')
        .eq('id', playlistId)
        .maybeSingle()
      if (error) throw error
      return data
    },

    async listPartsLight(playlistId) {
      const { data, error } = await client
        .from('playlist_parts')
        .select('id, title, kind, position')
        .eq('playlist_id', playlistId)
        .order('position', { ascending: true })
      if (error) throw error
      return data || []
    },

    async listParts(playlistId) {
      const { data, error } = await client
        .from('playlist_parts')
        .select('*')
        .eq('playlist_id', playlistId)
        .order('position', { ascending: true })
      if (error) throw error
      return data || []
    },

    async getPartById(partId) {
      const { data, error } = await client
        .from('playlist_parts')
        .select('*')
        .eq('id', partId)
        .maybeSingle()
      if (error) throw error
      return data
    },

    async insertPart({ playlistId, position, title, kind, content, mediaUrl }) {
      const { data, error } = await client
        .from('playlist_parts')
        .insert({
          playlist_id: playlistId,
          position,
          title,
          kind,
          content,
          media_url: mediaUrl,
        })
        .select()
        .maybeSingle()
      if (error) throw error
      return data
    },

    async updatePart(partId, updates) {
      const { error } = await client
        .from('playlist_parts')
        .update(updates)
        .eq('id', partId)
      if (error) throw error
    },

    async deletePart(partId) {
      const { error } = await client
        .from('playlist_parts')
        .delete()
        .eq('id', partId)
      if (error) throw error
    },
  }
}

export const playlistRepository = createPlaylistRepository()
