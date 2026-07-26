export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type ProjectStatus =
  | "draft"
  | "generating"
  | "ready"
  | "failed"
  | "archived";
export type JobKind = "create" | "edit";
export type JobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";
export type VersionStatus = "draft" | "runnable" | "failed";
export type MessageRole = "user" | "assistant" | "system";
/** Gates REMIX only. A private publication is still playable by anyone. */
export type WorkVisibility = "public" | "private";

export interface Profile {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  create_credits: number;
  edit_credits: number;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  user_id: string;
  title: string;
  original_prompt: string;
  status: ProjectStatus;
  current_version_id: string | null;
  /** Id of the `published_games` row this project was remixed from. */
  forked_from: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublishedGame {
  id: string;
  owner_id: string;
  project_id: string;
  version_id: string;
  slug: string;
  title: string;
  artifact_html: string;
  visibility: WorkVisibility;
  is_active: boolean;
  published_at: string;
}

/** Row shape returned by the `list_gallery` RPC. Never includes original_prompt. */
export interface GalleryItem {
  slug: string;
  title: string;
  author: string;
  visibility: WorkVisibility;
  is_remix: boolean;
  published_at: string;
}

export interface ProjectVersion {
  id: string;
  project_id: string;
  version_number: number;
  status: VersionStatus;
  source_snapshot: Json;
  artifact_html: string | null;
  build_log: Json;
  error_message: string | null;
  created_at: string;
}

export interface ProjectFile {
  project_id: string;
  path: string;
  content: string;
  byte_size: number;
  updated_at: string;
}

export interface Message {
  id: string;
  project_id: string;
  role: MessageRole;
  content: string;
  metadata: Json;
  created_at: string;
}
