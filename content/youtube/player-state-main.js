(() => {
  const publish = () => {
    try {
      const player = document.getElementById('movie_player');
      const data = player?.getVideoData?.() || {};
      const details = player?.getPlayerResponse?.()?.videoDetails || {};
      const allowLiveDvr = data.allowLiveDvr ?? data.isLiveDvrEnabled ?? details.allowLiveDvr ?? details.isLiveDvrEnabled;
      const isLive = data.isLive ?? details.isLive ?? details.isLiveContent;
      document.documentElement.dataset.chzzkVsYoutubePlayerState = JSON.stringify({ isLive: Boolean(isLive), allowLiveDvr: typeof allowLiveDvr === 'boolean' ? allowLiveDvr : null });
    } catch (_) {}
  };
  publish(); setInterval(publish, 500);
})();
