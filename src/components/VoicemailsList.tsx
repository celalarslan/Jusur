import React, { useState } from "react";
import { Mail, Calendar, ChevronDown, ChevronUp, AlignLeft } from "lucide-react";
import { VoicemailDocument } from "../types";

interface VoicemailsListProps {
  voicemails: VoicemailDocument[];
}

export function VoicemailsList({ voicemails }: VoicemailsListProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedId(prev => (prev === id ? null : id));
  };

  if (voicemails.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center bg-zinc-950 border border-zinc-800 rounded-2xl p-6">
        <div className="w-12 h-12 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-500 mb-4 font-mono select-none text-lg">
          ✉
        </div>
        <h3 className="font-extrabold text-sm text-zinc-300">No modern voicemails yet</h3>
        <p className="text-[11px] text-zinc-500 max-w-xs mt-1 leading-relaxed">
          When people call your line and you aren't active, your smart AI Secretary will log intent summaries in this feed.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {voicemails.map((voicemail) => {
        const isExpanded = expandedId === voicemail.id;
        const formattedDate = voicemail.timestamp?.toDate 
          ? voicemail.timestamp.toDate().toLocaleString() 
          : new Date().toLocaleString();

        return (
          <div 
            key={voicemail.id}
            className="border border-zinc-800 bg-zinc-950/80 rounded-xl overflow-hidden transition-all hover:border-zinc-700"
          >
            {/* Header / Clickable row */}
            <div 
              onClick={() => toggleExpand(voicemail.id)}
              className="flex items-center justify-between p-3.5 cursor-pointer select-none hover:bg-zinc-900/20"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-violet-950/30 border border-violet-900/30 flex items-center justify-center text-violet-400 font-mono shrink-0">
                  <Mail className="w-4.5 h-4.5" />
                </div>
                <div className="min-w-0">
                  <h4 className="font-bold text-xs text-zinc-200 truncate">
                    {voicemail.callerName}
                  </h4>
                  <p className="text-[10px] text-zinc-500 font-mono truncate">
                    {voicemail.callerEmail}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-right hidden sm:block">
                  <span className="text-[10px] text-zinc-500 font-mono flex items-center gap-1.5">
                    <Calendar className="w-3 h-3" />
                    {formattedDate.split(",")[0]}
                  </span>
                </div>
                {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-zinc-500" /> : <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />}
              </div>
            </div>

            {/* Expanded section */}
            {isExpanded && (
              <div className="px-3.5 pb-4 pt-1.5 border-t border-zinc-800 bg-zinc-950/90 space-y-3">
                {/* AI Summary Highlight */}
                <div className="p-3 rounded-lg bg-violet-950/20 border border-violet-900/20">
                  <span className="text-[9px] font-mono tracking-wider font-black text-violet-400 uppercase flex items-center gap-1 mb-1">
                    <AlignLeft className="w-3 h-3" />
                    Smart AI Intent Summary
                  </span>
                  <p className="text-[11px] text-zinc-300 leading-relaxed">
                    {voicemail.aiSummary || "The secretary was unable to distill a structural summary of the message."}
                  </p>
                </div>

                {/* Conversation log */}
                <div>
                  <span className="text-[9px] font-mono tracking-wider font-black text-violet-400 uppercase block mb-1">
                    Conversation logs
                  </span>
                  <div className="p-2.5 bg-zinc-900 border border-zinc-800 rounded-lg max-h-40 overflow-y-auto font-mono text-[10px] text-zinc-400 whitespace-pre-line leading-relaxed">
                    {voicemail.audioTranscript}
                  </div>
                </div>

                {/* Mobile Date support */}
                <div className="sm:hidden pt-1 px-1 text-right">
                  <span className="text-[9px] text-zinc-500 font-mono italic">
                    Logged: {formattedDate}
                  </span>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
