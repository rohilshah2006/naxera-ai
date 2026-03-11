'use client';

import { MessageSquareWarning } from 'lucide-react';

export default function FeedbackButton() {
  return (
    <a
      href="https://github.com/rohilshah2006/naxera-ai/issues/new"
      target="_blank"
      rel="noopener noreferrer"
      className="fixed bottom-6 left-6 w-12 h-12 group-hover:w-auto bg-white/10 hover:bg-white/20 text-white/50 hover:text-white rounded-full backdrop-blur-md transition-all duration-300 z-40 border border-white/10 shadow-2xl flex items-center justify-center group-hover:px-4 gap-0 group-hover:gap-2"
      title="Report an Issue"
    >
      <MessageSquareWarning className="w-6 h-6 flex-shrink-0" />
      <span className="max-w-0 overflow-hidden group-hover:max-w-xs transition-all duration-500 ease-in-out whitespace-nowrap text-sm font-medium">
        Report an Issue
      </span>
    </a>
  );
}
