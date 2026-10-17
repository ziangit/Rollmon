# data

`pokedex.json` and `moves.json` are generated from Pokémon Showdown's data
(MIT) and were carried over from the v1 repo (where foul-play's update script
produced them). The reference Python layer reads them for the legality matrix
and existence-only validation. The browser port replaces them with `@pkmn/dex`.
