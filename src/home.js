(function () {
  const cards = Array.isArray(window.TCG_CARDS) ? window.TCG_CARDS : [];

  function distinct(getKey) {
    return new Set(cards.map(getKey).filter(Boolean)).size;
  }

  function setStat(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value.toLocaleString("pt-BR");
  }

  setStat("statPokemon", distinct((card) => card.pokemonName || card.name));
  setStat("statCards", cards.length);
  setStat("statSets", distinct((card) => card.set));
  setStat("statArtists", distinct((card) => card.artist));
})();
