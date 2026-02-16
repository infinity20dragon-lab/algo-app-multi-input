"use client";

import { useEffect, useState, useMemo } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useAuth } from "@/contexts/auth-context";
import { getRecordings, deleteRecording } from "@/lib/firebase/firestore";
import type { Recording } from "@/lib/algo/types";
import {
  Folder,
  File,
  Play,
  Pause,
  Download,
  Trash2,
  Search,
  Calendar,
  User,
  Clock,
  FileAudio,
  AlertCircle,
  ChevronRight,
  ChevronDown,
  Filter,
} from "lucide-react";
import { cn } from "@/lib/utils";

export default function RecordingsPage() {
  const { user } = useAuth();
  const isAdmin = (user as any)?.role === "admin";

  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState<string>("all");
  const [selectedDate, setSelectedDate] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"date" | "user" | "size">("date");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // Audio player state
  const [playingRecording, setPlayingRecording] = useState<string | null>(null);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);

  // Folder expansion state
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  // Admin access check
  useEffect(() => {
    if (user && !isAdmin) {
      setError("Access denied. Admin privileges required.");
      setLoading(false);
    }
  }, [user, isAdmin]);

  // Load recordings
  useEffect(() => {
    if (!isAdmin) return;

    const loadRecordings = async () => {
      try {
        setLoading(true);
        const data = await getRecordings();
        setRecordings(data);
        setError(null);
      } catch (err) {
        console.error("Failed to load recordings:", err);
        setError("Failed to load recordings. Please try again.");
      } finally {
        setLoading(false);
      }
    };

    loadRecordings();
  }, [isAdmin]);

  // Get unique users and dates for filters
  const uniqueUsers = useMemo(() => {
    const users = new Set(recordings.map((r) => r.userEmail));
    return Array.from(users).sort();
  }, [recordings]);

  const uniqueDates = useMemo(() => {
    const dates = new Set(recordings.map((r) => r.dateKey));
    return Array.from(dates).sort().reverse();
  }, [recordings]);

  // Filter and sort recordings
  const filteredRecordings = useMemo(() => {
    let filtered = recordings;

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (r) =>
          r.filename.toLowerCase().includes(query) ||
          r.userEmail.toLowerCase().includes(query)
      );
    }

    // Apply user filter
    if (selectedUser !== "all") {
      filtered = filtered.filter((r) => r.userEmail === selectedUser);
    }

    // Apply date filter
    if (selectedDate !== "all") {
      filtered = filtered.filter((r) => r.dateKey === selectedDate);
    }

    // Sort recordings
    filtered = [...filtered].sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case "date":
          comparison = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
          break;
        case "user":
          comparison = a.userEmail.localeCompare(b.userEmail);
          break;
        case "size":
          comparison = a.size - b.size;
          break;
      }

      return sortOrder === "asc" ? comparison : -comparison;
    });

    return filtered;
  }, [recordings, searchQuery, selectedUser, selectedDate, sortBy, sortOrder]);

  // Calculate pagination
  const totalPages = Math.ceil(filteredRecordings.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedRecordings = filteredRecordings.slice(startIndex, endIndex);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedUser, selectedDate, sortBy, sortOrder]);

  // Group recordings by user and date (use paginated data)
  const groupedRecordings = useMemo(() => {
    const groups: Record<string, Record<string, Recording[]>> = {};

    paginatedRecordings.forEach((recording) => {
      if (!groups[recording.userEmail]) {
        groups[recording.userEmail] = {};
      }
      if (!groups[recording.userEmail][recording.dateKey]) {
        groups[recording.userEmail][recording.dateKey] = [];
      }
      groups[recording.userEmail][recording.dateKey].push(recording);
    });

    return groups;
  }, [paginatedRecordings]);

  // Toggle folder expansion
  const toggleFolder = (key: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // Play/pause recording
  const togglePlayback = (recording: Recording) => {
    if (playingRecording === recording.id) {
      // Pause current recording
      if (audioElement) {
        audioElement.pause();
      }
      setPlayingRecording(null);
    } else {
      // Stop previous audio if any
      if (audioElement) {
        audioElement.pause();
      }

      // Play new recording
      const audio = new Audio(recording.storageUrl);
      audio.play().catch((e: Error) => { if (e.name !== 'AbortError') throw e; });
      audio.onended = () => setPlayingRecording(null);
      setAudioElement(audio);
      setPlayingRecording(recording.id);
    }
  };

  // Download recording
  const downloadRecording = (recording: Recording) => {
    const link = document.createElement("a");
    link.href = recording.storageUrl;
    link.download = recording.filename;
    link.click();
  };

  // Delete recording
  const handleDeleteRecording = async (recording: Recording) => {
    if (!confirm(`Are you sure you want to delete ${recording.filename}?`)) {
      return;
    }

    try {
      await deleteRecording(recording.id);
      setRecordings((prev) => prev.filter((r) => r.id !== recording.id));
    } catch (err) {
      console.error("Failed to delete recording:", err);
      alert("Failed to delete recording. Please try again.");
    }
  };

  // Format file size
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  // Format timestamp
  const formatTimestamp = (date: Date): string => {
    return new Date(date).toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  if (!user) {
    return null;
  }

  if (!isAdmin) {
    return (
      <AppLayout>
        <div className="flex min-h-[60vh] items-center justify-center">
          <Card className="max-w-md">
            <CardContent className="pt-6">
              <div className="flex flex-col items-center gap-4 text-center">
                <div className="rounded-full bg-red-500/20 p-4">
                  <AlertCircle className="h-8 w-8 text-red-500" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-[var(--text-primary)]">
                    Access Denied
                  </h2>
                  <p className="mt-2 text-sm text-[var(--text-secondary)]">
                    You need admin privileges to access the recordings page.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-[var(--text-primary)]">Recordings</h1>
          <p className="text-[var(--text-secondary)] mt-1">
            Browse and manage all audio recordings
          </p>
        </div>

        {/* Filters Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Filter className="h-5 w-5" />
              Filters & Search
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Search */}
            <div>
              <Label>Search</Label>
              <div className="relative mt-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
                <Input
                  type="text"
                  placeholder="Search by filename or user..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            {/* Filter Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* User Filter */}
              <div>
                <Label>User</Label>
                <Select
                  value={selectedUser}
                  onChange={(e) => setSelectedUser(e.target.value)}
                  className="mt-1"
                >
                  <option value="all">All Users</option>
                  {uniqueUsers.map((userEmail) => (
                    <option key={userEmail} value={userEmail}>
                      {userEmail}
                    </option>
                  ))}
                </Select>
              </div>

              {/* Date Filter */}
              <div>
                <Label>Date</Label>
                <Select
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="mt-1"
                >
                  <option value="all">All Dates</option>
                  {uniqueDates.map((date) => (
                    <option key={date} value={date}>
                      {date}
                    </option>
                  ))}
                </Select>
              </div>

              {/* Sort By */}
              <div>
                <Label>Sort By</Label>
                <div className="flex gap-2 mt-1">
                  <Select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as any)}
                    className="flex-1"
                  >
                    <option value="date">Date</option>
                    <option value="user">User</option>
                    <option value="size">Size</option>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
                    className="px-3"
                  >
                    {sortOrder === "asc" ? "↑" : "↓"}
                  </Button>
                </div>
              </div>
            </div>

            {/* Stats & Pagination */}
            <div className="flex items-center justify-between pt-2 border-t border-[var(--border-color)]">
              <div className="flex items-center gap-6 text-sm text-[var(--text-secondary)]">
                <div className="flex items-center gap-2">
                  <FileAudio className="h-4 w-4" />
                  <span>
                    Showing {startIndex + 1}-{Math.min(endIndex, filteredRecordings.length)} of{" "}
                    {filteredRecordings.length}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4" />
                  <span>{uniqueUsers.length} users</span>
                </div>
              </div>

              {/* Pagination Controls */}
              {totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                  >
                    Previous
                  </Button>
                  <span className="text-sm text-[var(--text-secondary)] px-3">
                    Page {currentPage} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                  >
                    Next
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Recordings Tree */}
        {loading ? (
          <Card>
            <CardContent className="py-12">
              <div className="flex flex-col items-center gap-4">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-[var(--accent-blue)] border-t-transparent" />
                <span className="text-sm text-[var(--text-secondary)]">Loading recordings...</span>
              </div>
            </CardContent>
          </Card>
        ) : error ? (
          <Card>
            <CardContent className="py-12">
              <div className="flex flex-col items-center gap-4">
                <AlertCircle className="h-10 w-10 text-red-500" />
                <div className="text-center">
                  <p className="font-semibold text-[var(--text-primary)]">Error</p>
                  <p className="text-sm text-[var(--text-secondary)]">{error}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : filteredRecordings.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <div className="flex flex-col items-center gap-4">
                <FileAudio className="h-10 w-10 text-[var(--text-muted)]" />
                <div className="text-center">
                  <p className="font-semibold text-[var(--text-primary)]">No recordings found</p>
                  <p className="text-sm text-[var(--text-secondary)]">
                    {searchQuery || selectedUser !== "all" || selectedDate !== "all"
                      ? "Try adjusting your filters"
                      : "Recordings will appear here once audio is captured"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : paginatedRecordings.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <div className="flex flex-col items-center gap-4">
                <FileAudio className="h-10 w-10 text-[var(--text-muted)]" />
                <div className="text-center">
                  <p className="font-semibold text-[var(--text-primary)]">No recordings on this page</p>
                  <p className="text-sm text-[var(--text-secondary)]">
                    Go back to previous page or adjust your filters
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardContent className="p-0">
                <div className="divide-y divide-[var(--border-color)]">
                  {Object.entries(groupedRecordings).map(([userEmail, dateGroups]) => {
                    const userKey = `user-${userEmail}`;
                    const isUserExpanded = expandedFolders.has(userKey);

                    return (
                      <div key={userEmail}>
                        {/* User Folder */}
                        <button
                          onClick={() => toggleFolder(userKey)}
                          className="w-full flex items-center gap-3 p-4 hover:bg-[var(--bg-secondary)] transition-colors text-left"
                        >
                          {isUserExpanded ? (
                            <ChevronDown className="h-4 w-4 text-[var(--text-muted)]" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-[var(--text-muted)]" />
                          )}
                          <User className="h-5 w-5 text-[var(--accent-blue)]" />
                          <span className="font-semibold text-[var(--text-primary)]">{userEmail}</span>
                          <span className="text-sm text-[var(--text-muted)] ml-auto">
                            {Object.values(dateGroups).flat().length} recordings
                          </span>
                        </button>

                        {/* Date Folders */}
                        {isUserExpanded && (
                          <div className="pl-6">
                            {Object.entries(dateGroups).map(([dateKey, dateRecordings]) => {
                              const dateKeyFull = `${userKey}-${dateKey}`;
                              const isDateExpanded = expandedFolders.has(dateKeyFull);

                              return (
                                <div key={dateKey} className="border-l border-[var(--border-color)]">
                                  {/* Date Folder */}
                                  <button
                                    onClick={() => toggleFolder(dateKeyFull)}
                                    className="w-full flex items-center gap-3 p-4 pl-6 hover:bg-[var(--bg-secondary)] transition-colors text-left"
                                  >
                                    {isDateExpanded ? (
                                      <ChevronDown className="h-4 w-4 text-[var(--text-muted)]" />
                                    ) : (
                                      <ChevronRight className="h-4 w-4 text-[var(--text-muted)]" />
                                    )}
                                    <Calendar className="h-4 w-4 text-[var(--accent-green)]" />
                                    <span className="text-[var(--text-primary)]">{dateKey}</span>
                                    <span className="text-sm text-[var(--text-muted)] ml-auto">
                                      {dateRecordings.length} recordings
                                    </span>
                                  </button>

                                  {/* Recordings */}
                                  {isDateExpanded && (
                                    <div className="pl-6">
                                      {dateRecordings.map((recording) => (
                                        <div
                                          key={recording.id}
                                          className="flex items-center gap-3 p-4 pl-6 hover:bg-[var(--bg-secondary)] transition-colors border-l border-[var(--border-color)]"
                                        >
                                          <File className="h-4 w-4 text-[var(--text-muted)]" />
                                          <div className="flex-1 min-w-0">
                                            <div className="font-medium text-[var(--text-primary)] truncate">
                                              {recording.filename}
                                            </div>
                                            <div className="flex items-center gap-4 text-xs text-[var(--text-secondary)] mt-1">
                                              <span className="flex items-center gap-1">
                                                <Clock className="h-3 w-3" />
                                                {formatTimestamp(recording.timestamp)}
                                              </span>
                                              <span>{formatFileSize(recording.size)}</span>
                                            </div>
                                          </div>
                                          <div className="flex items-center gap-2">
                                            <Button
                                              size="sm"
                                              variant={playingRecording === recording.id ? "default" : "outline"}
                                              onClick={() => togglePlayback(recording)}
                                              title={playingRecording === recording.id ? "Pause" : "Play"}
                                            >
                                              {playingRecording === recording.id ? (
                                                <Pause className="h-4 w-4" />
                                              ) : (
                                                <Play className="h-4 w-4" />
                                              )}
                                            </Button>
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              onClick={() => downloadRecording(recording)}
                                              title="Download"
                                            >
                                              <Download className="h-4 w-4" />
                                            </Button>
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              onClick={() => handleDeleteRecording(recording)}
                                              title="Delete"
                                              className="text-red-500 hover:text-red-600"
                                            >
                                              <Trash2 className="h-4 w-4" />
                                            </Button>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Bottom Pagination */}
            {totalPages > 1 && (
              <Card>
                <CardContent className="py-4">
                  <div className="flex items-center justify-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                    >
                      Previous
                    </Button>
                    <span className="text-sm text-[var(--text-secondary)] px-3">
                      Page {currentPage} of {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                    >
                      Next
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
