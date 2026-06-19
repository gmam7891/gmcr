export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      _backup_stream_snapshots_20260430: {
        Row: {
          ai_confidence: number | null
          ai_evidence: string | null
          captured_at: string | null
          confidence_score: number | null
          extra_metadata: Json | null
          frame_index: number | null
          game_detected: string | null
          game_id: string | null
          game_name: string | null
          id: string | null
          is_ai_verified: boolean | null
          is_live: boolean | null
          processing_batch_id: string | null
          provider_detected: string | null
          source: string | null
          stream_title: string | null
          streamer_login: string | null
          timestamp_seconds: number | null
          viewer_count: number | null
          vod_id: string | null
        }
        Insert: {
          ai_confidence?: number | null
          ai_evidence?: string | null
          captured_at?: string | null
          confidence_score?: number | null
          extra_metadata?: Json | null
          frame_index?: number | null
          game_detected?: string | null
          game_id?: string | null
          game_name?: string | null
          id?: string | null
          is_ai_verified?: boolean | null
          is_live?: boolean | null
          processing_batch_id?: string | null
          provider_detected?: string | null
          source?: string | null
          stream_title?: string | null
          streamer_login?: string | null
          timestamp_seconds?: number | null
          viewer_count?: number | null
          vod_id?: string | null
        }
        Update: {
          ai_confidence?: number | null
          ai_evidence?: string | null
          captured_at?: string | null
          confidence_score?: number | null
          extra_metadata?: Json | null
          frame_index?: number | null
          game_detected?: string | null
          game_id?: string | null
          game_name?: string | null
          id?: string | null
          is_ai_verified?: boolean | null
          is_live?: boolean | null
          processing_batch_id?: string | null
          provider_detected?: string | null
          source?: string | null
          stream_title?: string | null
          streamer_login?: string | null
          timestamp_seconds?: number | null
          viewer_count?: number | null
          vod_id?: string | null
        }
        Relationships: []
      }
      access_packages: {
        Row: {
          allowed_tabs: string[]
          created_at: string
          description: string | null
          features: Json | null
          id: string
          max_streamers: number | null
          max_vods_month: number | null
          name: string
          tier: string | null
        }
        Insert: {
          allowed_tabs?: string[]
          created_at?: string
          description?: string | null
          features?: Json | null
          id?: string
          max_streamers?: number | null
          max_vods_month?: number | null
          name: string
          tier?: string | null
        }
        Update: {
          allowed_tabs?: string[]
          created_at?: string
          description?: string | null
          features?: Json | null
          id?: string
          max_streamers?: number | null
          max_vods_month?: number | null
          name?: string
          tier?: string | null
        }
        Relationships: []
      }
      agent_analyses: {
        Row: {
          agrees_with_pipeline: boolean | null
          confidence: number
          created_at: string
          duration_seconds: number
          end_seconds: number
          feedback_at: string | null
          game_library_id: string | null
          game_name: string
          id: string
          keyword_confidence: number
          provider_name: string | null
          start_seconds: number
          streamer_login: string
          user_confirmed: boolean | null
          user_corrected: boolean | null
          visual_confidence: number
          vod_id: string
        }
        Insert: {
          agrees_with_pipeline?: boolean | null
          confidence?: number
          created_at?: string
          duration_seconds?: number
          end_seconds?: number
          feedback_at?: string | null
          game_library_id?: string | null
          game_name: string
          id?: string
          keyword_confidence?: number
          provider_name?: string | null
          start_seconds?: number
          streamer_login: string
          user_confirmed?: boolean | null
          user_corrected?: boolean | null
          visual_confidence?: number
          vod_id: string
        }
        Update: {
          agrees_with_pipeline?: boolean | null
          confidence?: number
          created_at?: string
          duration_seconds?: number
          end_seconds?: number
          feedback_at?: string | null
          game_library_id?: string | null
          game_name?: string
          id?: string
          keyword_confidence?: number
          provider_name?: string | null
          start_seconds?: number
          streamer_login?: string
          user_confirmed?: boolean | null
          user_corrected?: boolean | null
          visual_confidence?: number
          vod_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_analyses_game_library_id_fkey"
            columns: ["game_library_id"]
            isOneToOne: false
            referencedRelation: "game_visual_library"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_detection_log: {
        Row: {
          col_index: number | null
          confidence: number | null
          created_at: string
          distinctive_elements: string[] | null
          frame_ts_seconds: number
          id: string
          matched_game_library_id: string | null
          mosaic_index: number | null
          outcome: string
          raw_response: Json | null
          reported_game_name: string | null
          row_index: number | null
          run_id: string | null
          screen_state: string | null
          streamer_login: string | null
          visual_evidence: string | null
          vod_id: string
        }
        Insert: {
          col_index?: number | null
          confidence?: number | null
          created_at?: string
          distinctive_elements?: string[] | null
          frame_ts_seconds?: number
          id?: string
          matched_game_library_id?: string | null
          mosaic_index?: number | null
          outcome: string
          raw_response?: Json | null
          reported_game_name?: string | null
          row_index?: number | null
          run_id?: string | null
          screen_state?: string | null
          streamer_login?: string | null
          visual_evidence?: string | null
          vod_id: string
        }
        Update: {
          col_index?: number | null
          confidence?: number | null
          created_at?: string
          distinctive_elements?: string[] | null
          frame_ts_seconds?: number
          id?: string
          matched_game_library_id?: string | null
          mosaic_index?: number | null
          outcome?: string
          raw_response?: Json | null
          reported_game_name?: string | null
          row_index?: number | null
          run_id?: string | null
          screen_state?: string | null
          streamer_login?: string | null
          visual_evidence?: string | null
          vod_id?: string
        }
        Relationships: []
      }
      agent_feedback: {
        Row: {
          analysis_id: string | null
          corrected_game_id: string | null
          correction_type: string
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          original_game_id: string | null
        }
        Insert: {
          analysis_id?: string | null
          corrected_game_id?: string | null
          correction_type: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          original_game_id?: string | null
        }
        Update: {
          analysis_id?: string | null
          corrected_game_id?: string | null
          correction_type?: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          original_game_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_feedback_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "agent_analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_feedback_corrected_game_id_fkey"
            columns: ["corrected_game_id"]
            isOneToOne: false
            referencedRelation: "game_visual_library"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_feedback_original_game_id_fkey"
            columns: ["original_game_id"]
            isOneToOne: false
            referencedRelation: "game_visual_library"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_runs: {
        Row: {
          completed_at: string | null
          created_at: string
          cursor_mosaic: number
          detections_count: number
          error_message: string | null
          id: string
          message: string | null
          plan: Json
          processed_tiles: number
          started_at: string | null
          status: string
          streamer_login: string
          total_mosaics: number
          total_tiles: number
          updated_at: string
          vod_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          cursor_mosaic?: number
          detections_count?: number
          error_message?: string | null
          id?: string
          message?: string | null
          plan?: Json
          processed_tiles?: number
          started_at?: string | null
          status?: string
          streamer_login: string
          total_mosaics?: number
          total_tiles?: number
          updated_at?: string
          vod_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          cursor_mosaic?: number
          detections_count?: number
          error_message?: string | null
          id?: string
          message?: string | null
          plan?: Json
          processed_tiles?: number
          started_at?: string | null
          status?: string
          streamer_login?: string
          total_mosaics?: number
          total_tiles?: number
          updated_at?: string
          vod_id?: string
        }
        Relationships: []
      }
      casino_catalog_thumbnails: {
        Row: {
          casino_name: string | null
          casino_slug: string
          created_at: string
          error_message: string | null
          game_library_id: string | null
          game_name_normalized: string
          game_name_raw: string
          id: string
          last_seen_at: string
          metadata: Json
          phash: string | null
          provider_name: string | null
          source_page_url: string | null
          status: string
          thumbnail_source_url: string | null
          thumbnail_url: string | null
          updated_at: string
        }
        Insert: {
          casino_name?: string | null
          casino_slug: string
          created_at?: string
          error_message?: string | null
          game_library_id?: string | null
          game_name_normalized: string
          game_name_raw: string
          id?: string
          last_seen_at?: string
          metadata?: Json
          phash?: string | null
          provider_name?: string | null
          source_page_url?: string | null
          status?: string
          thumbnail_source_url?: string | null
          thumbnail_url?: string | null
          updated_at?: string
        }
        Update: {
          casino_name?: string | null
          casino_slug?: string
          created_at?: string
          error_message?: string | null
          game_library_id?: string | null
          game_name_normalized?: string
          game_name_raw?: string
          id?: string
          last_seen_at?: string
          metadata?: Json
          phash?: string | null
          provider_name?: string | null
          source_page_url?: string | null
          status?: string
          thumbnail_source_url?: string | null
          thumbnail_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      casino_catalogs: {
        Row: {
          casino_name: string
          casino_slug: string
          created_at: string
          id: string
          is_active: boolean
          last_scraped_at: string | null
          notes: string | null
          updated_at: string
          urls: string[]
        }
        Insert: {
          casino_name: string
          casino_slug: string
          created_at?: string
          id?: string
          is_active?: boolean
          last_scraped_at?: string | null
          notes?: string | null
          updated_at?: string
          urls?: string[]
        }
        Update: {
          casino_name?: string
          casino_slug?: string
          created_at?: string
          id?: string
          is_active?: boolean
          last_scraped_at?: string | null
          notes?: string | null
          updated_at?: string
          urls?: string[]
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          created_at: string
          id: string
          intent_label: string | null
          is_bot: boolean | null
          is_spam: boolean | null
          message: string
          message_at: string
          platform: string
          sentiment_label: string | null
          source_id: string | null
          source_type: string
          streamer_login: string
          username: string
        }
        Insert: {
          created_at?: string
          id?: string
          intent_label?: string | null
          is_bot?: boolean | null
          is_spam?: boolean | null
          message: string
          message_at?: string
          platform?: string
          sentiment_label?: string | null
          source_id?: string | null
          source_type?: string
          streamer_login: string
          username: string
        }
        Update: {
          created_at?: string
          id?: string
          intent_label?: string | null
          is_bot?: boolean | null
          is_spam?: boolean | null
          message?: string
          message_at?: string
          platform?: string
          sentiment_label?: string | null
          source_id?: string | null
          source_type?: string
          streamer_login?: string
          username?: string
        }
        Relationships: []
      }
      detections: {
        Row: {
          confidence: number | null
          created_at: string
          detected_at: string
          exposure_seconds: number | null
          game_id: string | null
          game_name: string | null
          id: string
          offset_seconds: number | null
          platform: string
          provider_id: string | null
          provider_name: string | null
          source_id: string | null
          source_type: string
          streamer_login: string
          viewer_count: number | null
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          detected_at?: string
          exposure_seconds?: number | null
          game_id?: string | null
          game_name?: string | null
          id?: string
          offset_seconds?: number | null
          platform?: string
          provider_id?: string | null
          provider_name?: string | null
          source_id?: string | null
          source_type: string
          streamer_login: string
          viewer_count?: number | null
        }
        Update: {
          confidence?: number | null
          created_at?: string
          detected_at?: string
          exposure_seconds?: number | null
          game_id?: string | null
          game_name?: string | null
          id?: string
          offset_seconds?: number | null
          platform?: string
          provider_id?: string | null
          provider_name?: string | null
          source_id?: string | null
          source_type?: string
          streamer_login?: string
          viewer_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "detections_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "detections_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      discovery_prospects: {
        Row: {
          avatar_url: string | null
          avg_views: number | null
          bio: string | null
          briefing_id: string
          briefing_text: string | null
          created_at: string
          display_name: string | null
          follower_following_ratio: number | null
          followers: number | null
          has_casino_content: boolean | null
          id: string
          is_spam: boolean | null
          lives_last_30d: number | null
          location_declared: string | null
          location_inferred: string | null
          match_score: number | null
          org_id: string | null
          platform: string
          posts_last_30d: number | null
          profile_url: string | null
          score_breakdown: Json | null
          search_keywords: string[] | null
          username: string
        }
        Insert: {
          avatar_url?: string | null
          avg_views?: number | null
          bio?: string | null
          briefing_id?: string
          briefing_text?: string | null
          created_at?: string
          display_name?: string | null
          follower_following_ratio?: number | null
          followers?: number | null
          has_casino_content?: boolean | null
          id?: string
          is_spam?: boolean | null
          lives_last_30d?: number | null
          location_declared?: string | null
          location_inferred?: string | null
          match_score?: number | null
          org_id?: string | null
          platform?: string
          posts_last_30d?: number | null
          profile_url?: string | null
          score_breakdown?: Json | null
          search_keywords?: string[] | null
          username: string
        }
        Update: {
          avatar_url?: string | null
          avg_views?: number | null
          bio?: string | null
          briefing_id?: string
          briefing_text?: string | null
          created_at?: string
          display_name?: string | null
          follower_following_ratio?: number | null
          followers?: number | null
          has_casino_content?: boolean | null
          id?: string
          is_spam?: boolean | null
          lives_last_30d?: number | null
          location_declared?: string | null
          location_inferred?: string | null
          match_score?: number | null
          org_id?: string | null
          platform?: string
          posts_last_30d?: number | null
          profile_url?: string | null
          score_breakdown?: Json | null
          search_keywords?: string[] | null
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "discovery_prospects_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      exposure_blocks: {
        Row: {
          avg_viewers: number | null
          block_status: string | null
          confidence_avg: number | null
          created_at: string
          duration_seconds: number
          end_at: string
          game_id: string | null
          id: string
          is_reconciled: boolean | null
          peak_viewers: number | null
          platform: string
          provider_id: string | null
          source_id: string | null
          source_type: string
          start_at: string
          streamer_login: string
          viewer_minutes: number | null
        }
        Insert: {
          avg_viewers?: number | null
          block_status?: string | null
          confidence_avg?: number | null
          created_at?: string
          duration_seconds: number
          end_at: string
          game_id?: string | null
          id?: string
          is_reconciled?: boolean | null
          peak_viewers?: number | null
          platform?: string
          provider_id?: string | null
          source_id?: string | null
          source_type: string
          start_at: string
          streamer_login: string
          viewer_minutes?: number | null
        }
        Update: {
          avg_viewers?: number | null
          block_status?: string | null
          confidence_avg?: number | null
          created_at?: string
          duration_seconds?: number
          end_at?: string
          game_id?: string | null
          id?: string
          is_reconciled?: boolean | null
          peak_viewers?: number | null
          platform?: string
          provider_id?: string | null
          source_id?: string | null
          source_type?: string
          start_at?: string
          streamer_login?: string
          viewer_minutes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "exposure_blocks_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exposure_blocks_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      game_aliases: {
        Row: {
          alias: string
          game_id: string
          id: string
        }
        Insert: {
          alias: string
          game_id: string
          id?: string
        }
        Update: {
          alias?: string
          game_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_aliases_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
      game_visual_library: {
        Row: {
          agent_average_confidence: number | null
          agent_confidence_threshold: number | null
          agent_keywords: string[] | null
          agent_last_identified_at: string | null
          agent_learned_at: string | null
          agent_times_corrected: number | null
          agent_times_identified: number | null
          agent_visual_markers: string[] | null
          created_at: string
          error_message: string | null
          game_name: string
          hud_url: string | null
          id: string
          logo_url: string | null
          metadata: Json | null
          paytable_url: string | null
          provider_name: string
          provider_slug: string
          source_url: string | null
          thumbnail_phash: string | null
          thumbnails: Json
          training_status: Database["public"]["Enums"]["training_status"]
          updated_at: string
          visual_dna: Json | null
        }
        Insert: {
          agent_average_confidence?: number | null
          agent_confidence_threshold?: number | null
          agent_keywords?: string[] | null
          agent_last_identified_at?: string | null
          agent_learned_at?: string | null
          agent_times_corrected?: number | null
          agent_times_identified?: number | null
          agent_visual_markers?: string[] | null
          created_at?: string
          error_message?: string | null
          game_name: string
          hud_url?: string | null
          id?: string
          logo_url?: string | null
          metadata?: Json | null
          paytable_url?: string | null
          provider_name: string
          provider_slug: string
          source_url?: string | null
          thumbnail_phash?: string | null
          thumbnails?: Json
          training_status?: Database["public"]["Enums"]["training_status"]
          updated_at?: string
          visual_dna?: Json | null
        }
        Update: {
          agent_average_confidence?: number | null
          agent_confidence_threshold?: number | null
          agent_keywords?: string[] | null
          agent_last_identified_at?: string | null
          agent_learned_at?: string | null
          agent_times_corrected?: number | null
          agent_times_identified?: number | null
          agent_visual_markers?: string[] | null
          created_at?: string
          error_message?: string | null
          game_name?: string
          hud_url?: string | null
          id?: string
          logo_url?: string | null
          metadata?: Json | null
          paytable_url?: string | null
          provider_name?: string
          provider_slug?: string
          source_url?: string | null
          thumbnail_phash?: string | null
          thumbnails?: Json
          training_status?: Database["public"]["Enums"]["training_status"]
          updated_at?: string
          visual_dna?: Json | null
        }
        Relationships: []
      }
      gameplay_blocks: {
        Row: {
          confidence_avg: number
          confidence_max: number | null
          confidence_min: number | null
          created_at: string
          discard_reason: string | null
          duration_seconds: number
          end_seconds: number
          evidence_count: number
          game_id: string | null
          game_name: string | null
          id: string
          model_version: string | null
          platform: string
          processing_version: string | null
          provider_id: string | null
          provider_name: string | null
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          rules_version: string | null
          source_id: string | null
          source_type: string
          start_seconds: number
          status: string
          streamer_login: string
          updated_at: string
          vod_id: string
        }
        Insert: {
          confidence_avg?: number
          confidence_max?: number | null
          confidence_min?: number | null
          created_at?: string
          discard_reason?: string | null
          duration_seconds: number
          end_seconds: number
          evidence_count?: number
          game_id?: string | null
          game_name?: string | null
          id?: string
          model_version?: string | null
          platform?: string
          processing_version?: string | null
          provider_id?: string | null
          provider_name?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          rules_version?: string | null
          source_id?: string | null
          source_type?: string
          start_seconds: number
          status?: string
          streamer_login: string
          updated_at?: string
          vod_id: string
        }
        Update: {
          confidence_avg?: number
          confidence_max?: number | null
          confidence_min?: number | null
          created_at?: string
          discard_reason?: string | null
          duration_seconds?: number
          end_seconds?: number
          evidence_count?: number
          game_id?: string | null
          game_name?: string | null
          id?: string
          model_version?: string | null
          platform?: string
          processing_version?: string | null
          provider_id?: string | null
          provider_name?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          rules_version?: string | null
          source_id?: string | null
          source_type?: string
          start_seconds?: number
          status?: string
          streamer_login?: string
          updated_at?: string
          vod_id?: string
        }
        Relationships: []
      }
      games: {
        Row: {
          category: string | null
          created_at: string
          id: string
          name: string
          provider_id: string | null
          slug: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          id?: string
          name: string
          provider_id?: string | null
          slug: string
        }
        Update: {
          category?: string | null
          created_at?: string
          id?: string
          name?: string
          provider_id?: string | null
          slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "games_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      monitored_streamers: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          is_active: boolean
          login: string
          org_id: string | null
          twitch_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          is_active?: boolean
          login: string
          org_id?: string | null
          twitch_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          is_active?: boolean
          login?: string
          org_id?: string | null
          twitch_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "monitored_streamers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          id: string
          org_id: string
          role: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_user_id: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_user_id: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_user_id?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      pipeline_audit_logs: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          entity_id: string | null
          entity_type: string
          id: string
          performed_by: string | null
          vod_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type: string
          id?: string
          performed_by?: string | null
          vod_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          performed_by?: string | null
          vod_id?: string | null
        }
        Relationships: []
      }
      pipeline_configs: {
        Row: {
          config_key: string
          config_value: number
          description: string | null
          id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          config_key: string
          config_value: number
          description?: string | null
          id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          config_key?: string
          config_value?: number
          description?: string | null
          id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      processing_queue: {
        Row: {
          attempts: number | null
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          job_type: Database["public"]["Enums"]["job_type"]
          max_attempts: number | null
          metadata: Json | null
          platform: string
          priority: Database["public"]["Enums"]["job_priority"]
          source_id: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["job_status"]
          streamer_login: string
          updated_at: string
        }
        Insert: {
          attempts?: number | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          job_type: Database["public"]["Enums"]["job_type"]
          max_attempts?: number | null
          metadata?: Json | null
          platform?: string
          priority?: Database["public"]["Enums"]["job_priority"]
          source_id?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          streamer_login: string
          updated_at?: string
        }
        Update: {
          attempts?: number | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          job_type?: Database["public"]["Enums"]["job_type"]
          max_attempts?: number | null
          metadata?: Json | null
          platform?: string
          priority?: Database["public"]["Enums"]["job_priority"]
          source_id?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          streamer_login?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          current_org_id: string | null
          display_name: string | null
          email: string | null
          id: string
        }
        Insert: {
          created_at?: string
          current_org_id?: string | null
          display_name?: string | null
          email?: string | null
          id: string
        }
        Update: {
          created_at?: string
          current_org_id?: string | null
          display_name?: string | null
          email?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_current_org_id_fkey"
            columns: ["current_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_aliases: {
        Row: {
          alias: string
          id: string
          provider_id: string
        }
        Insert: {
          alias: string
          id?: string
          provider_id: string
        }
        Update: {
          alias?: string
          id?: string
          provider_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_aliases_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      providers: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
      raw_evidences: {
        Row: {
          casino_brand: string | null
          confidence_score: number
          created_at: string
          discard_reason: string | null
          extra_metadata: Json | null
          frame_index: number | null
          game_detected: string | null
          game_id: string | null
          id: string
          image_hash: string | null
          is_valid: boolean | null
          platform: string
          processing_batch_id: string | null
          provider_detected: string | null
          provider_id: string | null
          screen_state: string | null
          source_id: string | null
          source_type: string
          streamer_login: string
          timestamp_seconds: number
          validation_status: string | null
          vod_id: string
        }
        Insert: {
          casino_brand?: string | null
          confidence_score?: number
          created_at?: string
          discard_reason?: string | null
          extra_metadata?: Json | null
          frame_index?: number | null
          game_detected?: string | null
          game_id?: string | null
          id?: string
          image_hash?: string | null
          is_valid?: boolean | null
          platform?: string
          processing_batch_id?: string | null
          provider_detected?: string | null
          provider_id?: string | null
          screen_state?: string | null
          source_id?: string | null
          source_type?: string
          streamer_login: string
          timestamp_seconds?: number
          validation_status?: string | null
          vod_id: string
        }
        Update: {
          casino_brand?: string | null
          confidence_score?: number
          created_at?: string
          discard_reason?: string | null
          extra_metadata?: Json | null
          frame_index?: number | null
          game_detected?: string | null
          game_id?: string | null
          id?: string
          image_hash?: string | null
          is_valid?: boolean | null
          platform?: string
          processing_batch_id?: string | null
          provider_detected?: string | null
          provider_id?: string | null
          screen_state?: string | null
          source_id?: string | null
          source_type?: string
          streamer_login?: string
          timestamp_seconds?: number
          validation_status?: string | null
          vod_id?: string
        }
        Relationships: []
      }
      rejected_detections: {
        Row: {
          audit_id: string | null
          confidence: number | null
          created_at: string
          evidence: string | null
          id: string
          proposed_game: string | null
          proposed_provider: string | null
          raw_payload: Json | null
          reason: string
          streamer_login: string | null
          timestamp_seconds: number | null
          vod_id: string
        }
        Insert: {
          audit_id?: string | null
          confidence?: number | null
          created_at?: string
          evidence?: string | null
          id?: string
          proposed_game?: string | null
          proposed_provider?: string | null
          raw_payload?: Json | null
          reason: string
          streamer_login?: string | null
          timestamp_seconds?: number | null
          vod_id: string
        }
        Update: {
          audit_id?: string | null
          confidence?: number | null
          created_at?: string
          evidence?: string | null
          id?: string
          proposed_game?: string | null
          proposed_provider?: string | null
          raw_payload?: Json | null
          reason?: string
          streamer_login?: string | null
          timestamp_seconds?: number | null
          vod_id?: string
        }
        Relationships: []
      }
      stream_snapshots: {
        Row: {
          ai_confidence: number | null
          ai_evidence: string | null
          captured_at: string
          confidence_score: number | null
          extra_metadata: Json | null
          frame_index: number | null
          game_detected: string | null
          game_id: string | null
          game_name: string | null
          id: string
          is_ai_verified: boolean | null
          is_live: boolean
          processing_batch_id: string | null
          provider_detected: string | null
          source: string
          stream_title: string | null
          streamer_login: string
          timestamp_seconds: number | null
          viewer_count: number
          vod_id: string | null
        }
        Insert: {
          ai_confidence?: number | null
          ai_evidence?: string | null
          captured_at?: string
          confidence_score?: number | null
          extra_metadata?: Json | null
          frame_index?: number | null
          game_detected?: string | null
          game_id?: string | null
          game_name?: string | null
          id?: string
          is_ai_verified?: boolean | null
          is_live?: boolean
          processing_batch_id?: string | null
          provider_detected?: string | null
          source?: string
          stream_title?: string | null
          streamer_login: string
          timestamp_seconds?: number | null
          viewer_count?: number
          vod_id?: string | null
        }
        Update: {
          ai_confidence?: number | null
          ai_evidence?: string | null
          captured_at?: string
          confidence_score?: number | null
          extra_metadata?: Json | null
          frame_index?: number | null
          game_detected?: string | null
          game_id?: string | null
          game_name?: string | null
          id?: string
          is_ai_verified?: boolean | null
          is_live?: boolean
          processing_batch_id?: string | null
          provider_detected?: string | null
          source?: string
          stream_title?: string | null
          streamer_login?: string
          timestamp_seconds?: number | null
          viewer_count?: number
          vod_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stream_snapshots_streamer_login_fkey"
            columns: ["streamer_login"]
            isOneToOne: false
            referencedRelation: "monitored_streamers"
            referencedColumns: ["login"]
          },
        ]
      }
      user_access: {
        Row: {
          created_at: string
          created_by: string | null
          custom_tabs: string[] | null
          expires_at: string | null
          id: string
          is_active: boolean
          last_reset_at: string | null
          package_id: string | null
          streamers_used: number | null
          user_id: string
          vods_used_month: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          custom_tabs?: string[] | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          last_reset_at?: string | null
          package_id?: string | null
          streamers_used?: number | null
          user_id: string
          vods_used_month?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          custom_tabs?: string[] | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          last_reset_at?: string | null
          package_id?: string | null
          streamers_used?: number | null
          user_id?: string
          vods_used_month?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "user_access_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "access_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vod_audits: {
        Row: {
          completed_at: string | null
          confidence_score: number | null
          confirmed_blocks: number | null
          coverage_percent: number | null
          created_at: string
          data_quality_status: string | null
          discarded_blocks: number | null
          discarded_evidences: number | null
          error_message: string | null
          expected_frames: number | null
          failed_frames: number | null
          gap_seconds: number | null
          id: string
          last_checkpoint_at: string | null
          model_version: string | null
          org_id: string | null
          partial_reason: string | null
          pending_audit_segments: Json | null
          platform: string
          processed_duration_seconds: number | null
          processed_frames: number | null
          processing_version: string | null
          progress_current_minute: number | null
          progress_games_found: number | null
          progress_message: string | null
          progress_phase: string | null
          progress_total_minutes: number | null
          reconciliation_notes: string | null
          reconciliation_status: string | null
          rules_version: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["vod_status"]
          streamer_login: string
          sullygnome_snapshot: Json | null
          suspect_blocks: number | null
          total_evidences: number | null
          updated_at: string
          valid_evidences: number | null
          vod_created_at: string | null
          vod_duration_seconds: number | null
          vod_id: string
        }
        Insert: {
          completed_at?: string | null
          confidence_score?: number | null
          confirmed_blocks?: number | null
          coverage_percent?: number | null
          created_at?: string
          data_quality_status?: string | null
          discarded_blocks?: number | null
          discarded_evidences?: number | null
          error_message?: string | null
          expected_frames?: number | null
          failed_frames?: number | null
          gap_seconds?: number | null
          id?: string
          last_checkpoint_at?: string | null
          model_version?: string | null
          org_id?: string | null
          partial_reason?: string | null
          pending_audit_segments?: Json | null
          platform?: string
          processed_duration_seconds?: number | null
          processed_frames?: number | null
          processing_version?: string | null
          progress_current_minute?: number | null
          progress_games_found?: number | null
          progress_message?: string | null
          progress_phase?: string | null
          progress_total_minutes?: number | null
          reconciliation_notes?: string | null
          reconciliation_status?: string | null
          rules_version?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["vod_status"]
          streamer_login: string
          sullygnome_snapshot?: Json | null
          suspect_blocks?: number | null
          total_evidences?: number | null
          updated_at?: string
          valid_evidences?: number | null
          vod_created_at?: string | null
          vod_duration_seconds?: number | null
          vod_id: string
        }
        Update: {
          completed_at?: string | null
          confidence_score?: number | null
          confirmed_blocks?: number | null
          coverage_percent?: number | null
          created_at?: string
          data_quality_status?: string | null
          discarded_blocks?: number | null
          discarded_evidences?: number | null
          error_message?: string | null
          expected_frames?: number | null
          failed_frames?: number | null
          gap_seconds?: number | null
          id?: string
          last_checkpoint_at?: string | null
          model_version?: string | null
          org_id?: string | null
          partial_reason?: string | null
          pending_audit_segments?: Json | null
          platform?: string
          processed_duration_seconds?: number | null
          processed_frames?: number | null
          processing_version?: string | null
          progress_current_minute?: number | null
          progress_games_found?: number | null
          progress_message?: string | null
          progress_phase?: string | null
          progress_total_minutes?: number | null
          reconciliation_notes?: string | null
          reconciliation_status?: string | null
          rules_version?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["vod_status"]
          streamer_login?: string
          sullygnome_snapshot?: Json | null
          suspect_blocks?: number | null
          total_evidences?: number | null
          updated_at?: string
          valid_evidences?: number | null
          vod_created_at?: string | null
          vod_duration_seconds?: number | null
          vod_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vod_audits_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      provider_real_time: {
        Row: {
          avg_confidence: number | null
          distinct_streamers: number | null
          distinct_vods: number | null
          frame_count: number | null
          last_detected_at: string | null
          provider_name: string | null
          total_hours: number | null
          total_minutes: number | null
          total_seconds: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      find_game_by_phash: {
        Args: { max_distance?: number; query_phash: string }
        Returns: {
          casino_slug: string
          distance: number
          game_library_id: string
          game_name: string
          provider_name: string
          source: string
        }[]
      }
      get_user_org_ids: {
        Args: { _user_id: string }
        Returns: {
          org_id: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_org_member: {
        Args: { _org_id: string; _user_id: string }
        Returns: boolean
      }
      is_org_role: {
        Args: {
          _org_id: string
          _role: Database["public"]["Enums"]["org_role"]
          _user_id: string
        }
        Returns: boolean
      }
      phash_hamming: { Args: { a: string; b: string }; Returns: number }
    }
    Enums: {
      app_role: "admin" | "user"
      job_priority: "critical" | "high" | "normal" | "low"
      job_status: "pending" | "running" | "completed" | "failed" | "cancelled"
      job_type:
        | "live_capture"
        | "vod_process"
        | "chat_ingest"
        | "reconciliation"
        | "reprocess"
      org_role: "owner" | "admin" | "member"
      training_status: "pending" | "processing" | "trained" | "failed"
      vod_status:
        | "queued"
        | "processing"
        | "partial"
        | "completed"
        | "failed"
        | "needs_review"
        | "reprocessed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
      job_priority: ["critical", "high", "normal", "low"],
      job_status: ["pending", "running", "completed", "failed", "cancelled"],
      job_type: [
        "live_capture",
        "vod_process",
        "chat_ingest",
        "reconciliation",
        "reprocess",
      ],
      org_role: ["owner", "admin", "member"],
      training_status: ["pending", "processing", "trained", "failed"],
      vod_status: [
        "queued",
        "processing",
        "partial",
        "completed",
        "failed",
        "needs_review",
        "reprocessed",
      ],
    },
  },
} as const
