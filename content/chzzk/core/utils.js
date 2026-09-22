/**
 * ============================================================================
 * [라이브샷] 공용 유틸리티
 * 
 * @file        content/core/utils.js
 * @description 공통 유틸리티 함수 모음 (Core Utilities)
 * @author      LiveShot
 * @version     1.0.0
 * @updated     2026-09-04
 * 
 * [화면 및 주요 기능 설명]
 * 1. 유저 해시 ID 추출 및 HTML 특수문자 이스케이프
 * 2. 치지직 DOM 스트리머 메타데이터 및 비디오 플레이어 엘리먼트 탐색
 * 3. 2D 캔버스 기반 고화질 비디오 프레임 캡처 엔진
 * 4. 글로벌 토스트 알림(Toast Notification) 렌더링
 * ============================================================================
 */

window.ChzzkVS = window.ChzzkVS || {};

(function () {
  'use strict';

  const UTILS = {
    // 32자리 16진수 해시 추출
    extractUserHash: (input) => {
      if (!input || typeof input !== 'string') return null;
      const match = input.match(/([a-f0-9]{32})/i);
      return match ? match[1].toLowerCase() : null;
    },

    // HTML 특수문자 이스케이프
    escapeHtml: (str) => {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    },

    // ISO 날짜 문자열 포맷팅 (YYYY.MM.DD HH:mm)
    formatDate: (isoStr) => {
      if (!isoStr) return '';
      try {
        const d = new Date(isoStr);
        return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      } catch {
        return '';
      }
    },

    // 페이지 제목 및 DOM에서 스트리머 정보 추출
    getStreamerMetadata: () => {
      let streamer = '';
      let title = '';

      const channelNameEl = document.querySelector(
        '[class*="channel_name"], [class*="streamer_name"], [class*="live_information_channel"], [class*="video_information_channel"]'
      );
      if (channelNameEl) streamer = channelNameEl.textContent.trim();

      const liveTitleEl = document.querySelector(
        '[class*="live_information_title"], [class*="video_information_title"], [class*="video_title"]'
      );
      if (liveTitleEl) title = liveTitleEl.textContent.trim();

      if (!streamer || !title) {
        const docTitle = document.title || '';
        const parts = docTitle.split('-').map(s => s.trim());
        if (parts.length >= 2) {
          if (!streamer) streamer = parts[0];
          if (!title) title = parts.slice(1).join(' - ').replace(/\s*:\s*치지직.*$/, '').trim();
        } else if (!streamer) {
          streamer = docTitle.replace(/\s*:\s*치지직.*$/, '').trim();
        }
      }

      return {
        streamer: streamer || '치지직 스트리머',
        title: title || (document.title || '치지직 라이브')
      };
    },

    // URL 경로를 기반으로 현재 페이지 타입 판별
    detectPageType: () => {
      const path = window.location.pathname;
      let newType = 'HOME';
      let channelHash = null;

      const liveMatch = path.match(/\/live\/([a-f0-9]{32})/i);
      const hashMatch = path.match(/^\/([a-f0-9]{32})/i);

      if (liveMatch) {
        newType = 'LIVE';
        channelHash = liveMatch[1].toLowerCase();
      } else if (path.startsWith('/live/')) {
        newType = 'LIVE';
      } else if (path.startsWith('/video/')) {
        newType = 'VIDEO';
      } else if (path.startsWith('/clips/') || path.startsWith('/shorts/')) {
        newType = 'CLIP';
      } else if (hashMatch) {
        newType = 'CHANNEL';
        channelHash = hashMatch[1].toLowerCase();
      }

      return { pageType: newType, channelHash };
    },

    // 메인 비디오 엘리먼트 탐색
    findMainVideoElement: (pageType = 'LIVE') => {
      const liveVideo = document.querySelector(
        '#live_player_layout video, [class*="live_player"] video, [class*="webplayer_video"] video, .webplayer-internal-video, [class*="player_container"] video'
      );
      if (liveVideo) return liveVideo;

      const allVideos = Array.from(document.querySelectorAll('video'));
      if (allVideos.length === 0) return null;
      if (allVideos.length === 1) return allVideos[0];

      // 화면에서 가장 큰 비디오 엘리먼트 반환
      let bestVideo = allVideos[0];
      let maxArea = 0;
      for (const v of allVideos) {
        const rect = v.getBoundingClientRect();
        const area = rect.width * rect.height;
        if (area > maxArea) {
          maxArea = area;
          bestVideo = v;
        }
      }
      return bestVideo;
    },

    // 라이브 시청 화면 컨텍스트 여부
    isLiveWatchingContext: () => {
      if (ChzzkVS.state?.currentPageType === 'LIVE') return true;
      const path = window.location.pathname;
      if (path.startsWith('/live/') || path.match(/^\/[a-f0-9]{32}/i)) return true;
      if (path.startsWith('/clips/') || path.startsWith('/shorts/') || path.startsWith('/video/')) return false;

      const hasLiveVideo = Boolean(document.querySelector('video, .webplayer-internal-video, [class*="live_player"] video'));
      const hasChat = Boolean(document.querySelector('[class*="live_chatting"], [class*="chatting"], aside[class*="chat"], aside'));
      return hasLiveVideo || hasChat;
    }
  };

  // ─── 토스트 알림 ───
  function showToast(message, duration = 2500) {
    let toast = document.getElementById('chzzk-toolkit-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'chzzk-toolkit-toast';
      toast.className = 'chzzk-tk-toast';
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.classList.add('show');

    clearTimeout(toast.__hideTimer);
    toast.__hideTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, duration);
  }

  // ChzzkVS 네임스페이스 등록
  ChzzkVS.UTILS = UTILS;
  ChzzkVS.showToast = showToast;
  ChzzkVS.PRESET_COLORS = ['#00FFA3', '#4EA8DE', '#FF6B6B', '#FFB703', '#9D4EDD'];
})();
