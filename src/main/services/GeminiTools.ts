import type { GeminiToolDefinition } from './GeminiService'
import { getDatabase } from '../database/getDatabase'
import { getQualityAnalyzer } from './QualityAnalyzer'
import { getTMDBService } from './TMDBService'

/** Strip null/undefined/empty fields to reduce token usage */
function compact(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && v !== undefined && v !== '') result[k] = v
  }
  return result
}

/**
 * Tool definitions for Gemini AI library chat assistant.
 * Each tool maps to existing DatabaseService / QualityAnalyzer methods.
 */

export const LIBRARY_TOOLS: GeminiToolDefinition[] = [
  {
    name: 'search_library',
    description: 'Search the media library by title. Returns movies, TV shows, episodes, artists, albums, and tracks matching the query.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (title, artist name, etc.)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_media_items',
    description: 'Get movies or TV episodes from the library with optional filters. Use this to find items by quality tier, type, or to list upgrades needed.',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['movie', 'episode'], description: 'Filter by media type' },
        quality_tier: { type: 'string', enum: ['SD', '720p', '1080p', '4K'], description: 'Filter by resolution tier' },
        tier_quality: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'], description: 'Filter by quality level within tier' },
        needs_upgrade: { type: 'boolean', description: 'Only return items that need quality upgrades' },
        search_query: { type: 'string', description: 'Search by title' },
        sort_by: { type: 'string', enum: ['title', 'year', 'tier_score', 'overall_score', 'updated_at'], description: 'Sort field' },
        sort_order: { type: 'string', enum: ['asc', 'desc'], description: 'Sort direction' },
        limit: { type: 'number', description: 'Max results to return (default 20, max 50)' },
      },
    },
  },
  {
    name: 'get_tv_shows',
    description: 'Get a list of TV shows in the library. Returns series titles with episode/season counts.',
    parameters: {
      type: 'object',
      properties: {
        search_query: { type: 'string', description: 'Search by show title' },
        sort_by: { type: 'string', enum: ['title', 'episode_count', 'season_count'] },
        limit: { type: 'number', description: 'Max results (default 20, max 50)' },
      },
    },
  },
  {
    name: 'get_library_stats',
    description: 'Get overall library statistics: total items, quality breakdowns, upgrade counts, and average quality scores for movies and TV separately.',
    parameters: {
      type: 'object',
      properties: {
        source_id: { type: 'string', description: 'Optional: limit stats to a specific source' },
      },
    },
  },
  {
    name: 'get_quality_distribution',
    description: 'Get the quality distribution across the entire library. Shows counts by tier (SD/720p/1080p/4K) and quality level (LOW/MEDIUM/HIGH).',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_series_completeness',
    description: 'Get TV series completeness data. Shows which series are complete/incomplete with missing episode details.',
    parameters: {
      type: 'object',
      properties: {
        series_title: { type: 'string', description: 'Optional: filter to a specific series by title' },
        incomplete_only: { type: 'boolean', description: 'Only return incomplete series (default false)' },
        limit: { type: 'number', description: 'Max results (default 20, max 50)' },
      },
    },
  },
  {
    name: 'get_collection_completeness',
    description: 'Get movie collection (franchise) completeness. Shows which collections are complete/incomplete with missing movie details.',
    parameters: {
      type: 'object',
      properties: {
        incomplete_only: { type: 'boolean', description: 'Only return incomplete collections (default false)' },
        limit: { type: 'number', description: 'Max results (default 20, max 50)' },
      },
    },
  },
  {
    name: 'get_music_stats',
    description: 'Get music library statistics: total artists, albums, tracks, and quality breakdown.',
    parameters: {
      type: 'object',
      properties: {
        source_id: { type: 'string', description: 'Optional: limit stats to a specific source' },
      },
    },
  },
  {
    name: 'get_source_list',
    description: 'List all configured media sources (Plex, Jellyfin, Emby, Kodi, Local Folders) with their status.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_wishlist',
    description: 'Get the user\'s wishlist/shopping list items. Shows items they want to acquire or upgrade.',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', enum: ['missing', 'upgrade'], description: 'Filter by reason' },
        media_type: { type: 'string', enum: ['movie', 'episode', 'season', 'album', 'track'], description: 'Filter by media type' },
        limit: { type: 'number', description: 'Max results (default 20, max 50)' },
      },
    },
  },
  {
    name: 'search_tmdb',
    description: 'Search TMDB (The Movie Database) for movies, TV shows, or movie franchises and cross-reference with the user\'s library. Use this when users ask about specific franchises, or want to know if they own something or what they\'re missing.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (franchise name, movie title, TV show name)' },
        search_type: { type: 'string', enum: ['movie', 'tv', 'collection'], description: 'Type of search. Use "collection" for franchises (e.g., Star Wars, Marvel, Harry Potter) — searches both official TMDB collections AND standalone movies matching the query. Use "movie" for specific movies. Use "tv" for TV shows.' },
      },
      required: ['query', 'search_type'],
    },
  },
]

/**
 * Execute a tool by name with the given input.
 * Returns a JSON string result for Gemini to process.
 */
export async function executeTool(
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  const db = getDatabase()

  switch (name) {
    case 'search_library': {
      const query = input.query as string
      const results = db.globalSearch(query, 10)
      return JSON.stringify(results)
    }

    case 'get_media_items': {
      const limit = Math.min((input.limit as number) || 20, 50)
      const items = db.getMediaItems({
        type: input.type as 'movie' | 'episode' | undefined,
        qualityTier: input.quality_tier as string | undefined,
        tierQuality: input.tier_quality as string | undefined,
        needsUpgrade: input.needs_upgrade as boolean | undefined,
        searchQuery: input.search_query as string | undefined,
        sortBy: (input.sort_by as string | undefined) || 'title',
        sortOrder: (input.sort_order as 'asc' | 'desc' | undefined) || 'asc',
        limit,
      })
      const simplified = items.map((item: Record<string, unknown>) => compact({
        title: item.title,
        year: item.year,
        type: item.type,
        series_title: item.series_title,
        season_number: item.season_number,
        episode_number: item.episode_number,
        resolution: item.resolution,
        video_codec: item.video_codec,
        video_bitrate: item.video_bitrate,
        audio_codec: item.audio_codec,
        quality_tier: item.quality_tier,
        tier_quality: item.tier_quality,
        tier_score: item.tier_score,
        needs_upgrade: item.needs_upgrade,
      }))
      return JSON.stringify({ count: items.length, items: simplified })
    }

    case 'get_tv_shows': {
      const limit = Math.min((input.limit as number) || 20, 50)
      const shows = db.getTVShows({
        searchQuery: input.search_query as string | undefined,
        sortBy: (input.sort_by as 'title' | 'episode_count' | 'season_count' | undefined) || 'title',
        limit,
      })
      const simplified = shows.map((s: Record<string, unknown>) => compact({
        series_title: s.series_title,
        episode_count: s.episode_count,
        season_count: s.season_count,
      }))
      return JSON.stringify({ count: shows.length, shows: simplified })
    }

    case 'get_library_stats': {
      const stats = db.getLibraryStats(input.source_id as string | undefined)
      return JSON.stringify(stats)
    }

    case 'get_quality_distribution': {
      const distribution = getQualityAnalyzer().getQualityDistribution()
      return JSON.stringify(distribution)
    }

    case 'get_series_completeness': {
      let series
      if (input.series_title) {
        const single = db.getSeriesCompletenessByTitle(
          input.series_title as string,
        )
        series = single ? [single] : []
      } else if (input.incomplete_only) {
        series = db.getIncompleteSeries()
      } else {
        series = db.getAllSeriesCompleteness()
      }
      const limit = Math.min((input.limit as number) || 20, 50)
      const limited = series.slice(0, limit)
      const simplified = limited.map((s: Record<string, unknown>) => {
        let missingCount = 0
        let missingSample: string[] = []
        try {
          const parsed = JSON.parse((s.missing_episodes as string) || '[]')
          missingCount = parsed.length
          missingSample = parsed.slice(0, 5).map((e: Record<string, unknown>) =>
            `S${e.season_number}E${e.episode_number}`,
          )
        } catch { /* empty */ }
        return compact({
          series_title: s.series_title,
          total_seasons: s.total_seasons,
          total_episodes: s.total_episodes,
          owned_episodes: s.owned_episodes,
          completeness_percentage: s.completeness_percentage,
          status: s.status,
          missing_count: missingCount,
          missing_sample: missingSample.length > 0 ? missingSample : undefined,
        })
      })
      return JSON.stringify({ count: series.length, shown: limited.length, series: simplified })
    }

    case 'get_collection_completeness': {
      let collections
      if (input.incomplete_only) {
        collections = db.getIncompleteMovieCollections()
      } else {
        collections = db.getMovieCollections()
      }
      const limit = Math.min((input.limit as number) || 20, 50)
      const limited = collections.slice(0, limit)
      const simplified = limited.map((c: Record<string, unknown>) => {
        let missingCount = 0
        let missingSample: string[] = []
        try {
          const parsed = JSON.parse((c.missing_movies as string) || '[]')
          missingCount = parsed.length
          missingSample = parsed.slice(0, 5).map((m: Record<string, unknown>) =>
            m.year ? `${m.title} (${m.year})` : `${m.title}`,
          )
        } catch { /* empty */ }
        return compact({
          collection_name: c.collection_name,
          total_movies: c.total_movies,
          owned_movies: c.owned_movies,
          completeness_percentage: c.completeness_percentage,
          missing_count: missingCount,
          missing_sample: missingSample.length > 0 ? missingSample : undefined,
        })
      })
      return JSON.stringify({ count: collections.length, shown: limited.length, collections: simplified })
    }

    case 'get_music_stats': {
      const stats = db.getMusicStats(input.source_id as string | undefined)
      return JSON.stringify(stats)
    }

    case 'get_source_list': {
      const stats = db.getAggregatedSourceStats()
      return JSON.stringify(stats)
    }

    case 'get_wishlist': {
      const limit = Math.min((input.limit as number) || 20, 50)
      const items = db.getWishlistItems({
        reason: input.reason as 'missing' | 'upgrade' | undefined,
        media_type: input.media_type as string | undefined,
        limit,
        status: 'active',
      })
      const simplified = items.map((item: Record<string, unknown>) => compact({
        media_type: item.media_type,
        title: item.title,
        year: item.year,
        reason: item.reason,
        priority: item.priority,
        series_title: item.series_title,
        collection_name: item.collection_name,
        artist_name: item.artist_name,
        current_quality_tier: item.current_quality_tier,
        current_quality_level: item.current_quality_level,
      }))
      return JSON.stringify({ count: items.length, items: simplified })
    }

    case 'search_tmdb': {
      const query = input.query as string
      const searchType = input.search_type as string
      const tmdb = getTMDBService()

      if (searchType === 'collection') {
        // Search both collections AND general movies to catch standalone franchise films
        const [collectionResults, movieResults] = await Promise.all([
          tmdb.searchCollection(query),
          tmdb.searchMovie(query),
        ])
        const collections = collectionResults.results.slice(0, 3)

        // Track all TMDB IDs we've already included from collections to avoid duplicates
        const seenTmdbIds = new Set<string>()
        const collectionData = []

        for (const col of collections) {
          const details = await tmdb.getCollectionDetails(String(col.id))
          const tmdbIds = details.parts.map((p) => String(p.id))
          tmdbIds.forEach((id) => seenTmdbIds.add(id))

          // Cross-reference with owned media
          const ownedByTmdbId = db.getMediaItemsByTmdbIds(tmdbIds)

          const movies = details.parts
            .filter((p) => p.release_date && new Date(p.release_date) <= new Date())
            .map((p) => {
              const ownedItem = ownedByTmdbId.get(String(p.id)) as Record<string, unknown> | undefined
              return {
                title: p.title,
                year: p.release_date?.substring(0, 4) || null,
                tmdb_id: p.id,
                owned: !!ownedItem,
                quality: ownedItem ? `${ownedItem.quality_tier} ${ownedItem.tier_quality}` : null,
              }
            })

          collectionData.push({
            collection_name: details.name,
            total_movies: movies.length,
            owned_count: movies.filter((m) => m.owned).length,
            missing_count: movies.filter((m) => !m.owned).length,
            movies,
          })
        }

        // Find standalone movies matching the query that aren't in any collection
        const standaloneMovies = movieResults.results
          .filter((m) => !seenTmdbIds.has(String(m.id)))
          .slice(0, 10)

        let standaloneData = null
        if (standaloneMovies.length > 0) {
          const tmdbIds = standaloneMovies.map((m) => String(m.id))
          const ownedByTmdbId = db.getMediaItemsByTmdbIds(tmdbIds)

          const movies = standaloneMovies
            .filter((m) => m.release_date && new Date(m.release_date) <= new Date())
            .map((m) => {
              const ownedItem = ownedByTmdbId.get(String(m.id)) as Record<string, unknown> | undefined
              return {
                title: m.title,
                year: m.release_date?.substring(0, 4) || null,
                tmdb_id: m.id,
                owned: !!ownedItem,
                quality: ownedItem ? `${ownedItem.quality_tier} ${ownedItem.tier_quality}` : null,
              }
            })

          standaloneData = {
            label: `Other "${query}" movies (not in a collection)`,
            total_movies: movies.length,
            owned_count: movies.filter((m) => m.owned).length,
            missing_count: movies.filter((m) => !m.owned).length,
            movies,
          }
        }

        if (collectionData.length === 0 && !standaloneData) {
          return JSON.stringify({ message: `No movies or collections found matching "${query}"` })
        }

        return JSON.stringify({
          collections_found: collectionData.length,
          collections: collectionData,
          standalone_movies: standaloneData,
        })
      }

      if (searchType === 'movie') {
        const searchResults = await tmdb.searchMovie(query)
        const movies = searchResults.results.slice(0, 10)

        if (movies.length === 0) {
          return JSON.stringify({ message: `No movies found matching "${query}"` })
        }

        const tmdbIds = movies.map((m) => String(m.id))
        const ownedByTmdbId = db.getMediaItemsByTmdbIds(tmdbIds)

        const results = movies.map((m) => {
          const ownedItem = ownedByTmdbId.get(String(m.id)) as Record<string, unknown> | undefined
          return {
            title: m.title,
            year: m.release_date?.substring(0, 4) || null,
            tmdb_id: m.id,
            owned: !!ownedItem,
            quality: ownedItem ? {
              resolution: ownedItem.resolution,
              video_codec: ownedItem.video_codec,
              video_bitrate: ownedItem.video_bitrate,
              audio_codec: ownedItem.audio_codec,
              quality_tier: ownedItem.quality_tier,
              tier_quality: ownedItem.tier_quality,
            } : null,
          }
        })

        return JSON.stringify({ movies_found: results.length, results })
      }

      if (searchType === 'tv') {
        const searchResults = await tmdb.searchTVShow(query)
        const shows = searchResults.results.slice(0, 10)

        if (shows.length === 0) {
          return JSON.stringify({ message: `No TV shows found matching "${query}"` })
        }

        // Cross-reference with owned TV shows by title
        const results = shows.map((s) => {
          const tvShows = db.getTVShows({ searchQuery: s.name, limit: 1 })
          const match = tvShows.length > 0 ? tvShows[0] : null

          return {
            title: s.name,
            first_air_date: s.first_air_date,
            tmdb_id: s.id,
            overview: s.overview?.substring(0, 150) || null,
            owned_episodes: match ? (match as Record<string, unknown>).episode_count : 0,
            in_library: !!match,
          }
        })

        return JSON.stringify({ shows_found: results.length, results })
      }

      return JSON.stringify({ error: `Unknown search_type: ${searchType}` })
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` })
  }
}
