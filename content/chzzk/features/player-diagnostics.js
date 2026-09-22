/* Read-only diagnostics. Never reads cookies, storage, playback URLs or tokens. */
(() => {
  const number = value => Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
  const ranges = value => {
    const result = [];
    try { for (let i = 0; i < value.length; i++) result.push({ start: number(value.start(i)), end: number(value.end(i)) }); } catch (_) {}
    return result;
  };
  globalThis.LiveShotPlayerDiagnostics = video => {
    if (!video) return { playerFound: false, note: '현재 페이지에서 영상 요소를 찾지 못했습니다.' };
    const seekable = ranges(video.seekable), buffered = ranges(video.buffered);
    const current = video.currentTime;
    const activeRange = seekable.find(range => current >= range.start && current <= range.end);
    return {
      playerFound: true,
      resolution: `${video.videoWidth}x${video.videoHeight}`,
      readyState: video.readyState,
      paused: video.paused,
      currentTimeSeconds: number(current),
      durationSeconds: number(video.duration),
      seekable, buffered,
      seekableTotalSeconds: number(seekable.reduce((total,range) => total + range.end - range.start, 0)),
      rewindFromCurrentSeconds: activeRange ? number(current - activeRange.start) : null,
      note: '초 단위의 읽기 전용 결과입니다. seekable은 플레이어가 알리는 범위이며 실제 이동 성공을 보장하지 않습니다. 영상 주소·쿠키·계정 정보는 포함하지 않습니다.'
    };
  };
  // Use the page's normal authenticated request. Do not read or export cookies.
  globalThis.LiveShotAuthenticatedPlaybackCheck = async channelId => {
    if (!/^[a-f0-9]{32}$/.test(channelId || '')) return { status: 'invalid-channel' };
    try {
      const response = await fetch(`https://api.chzzk.naver.com/service/v3/channels/${channelId}/live-detail`, {
        credentials: 'include', redirect: 'error', signal: AbortSignal.timeout(12000)
      });
      if (!response.ok) return { status: 'http-error', httpStatus: response.status };
      const payload = await response.json();
      const content = payload.content;
      const playback = JSON.parse(content?.livePlaybackJson || 'null');
      const hls = playback?.media?.find(item => item.mediaId === 'HLS');
      return { status: 'checked', broadcastStatus: content?.status || null,
        hasPlayback: Boolean(playback), hasHls: Boolean(hls?.path),
        note: '영상 주소·계정·쿠키는 결과에 포함하지 않습니다. hasHls=true는 주소 확보 가능성을 뜻하며 독립 재생 성공 검증은 별도입니다.' };
    } catch (error) {
      return { status: error.name === 'TimeoutError' ? 'timeout' : 'request-failed',
        note: '브라우저의 요청 제한 또는 네트워크 오류일 수 있습니다. 로그인 실패로 단정할 수 없습니다.' };
    }
  };
})();
