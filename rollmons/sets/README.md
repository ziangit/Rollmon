# Pokemon set overrides

Add one `.txt` file per species. The filename is the normalized Showdown
species ID, such as `charizard.txt`, and the file contains one or more standard
Pokemon Showdown export blocks separated by a blank line. Each block becomes a
loadout choice; a nickname becomes the set's label. Level is forced to 100 and
`Tera Type:` lines are dropped.
