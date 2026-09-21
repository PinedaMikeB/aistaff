# Taglish Frontend Audit

This report compares candidate text frontends before StyleTTS2 training.

Important: a frontend is not approved just because it runs. Filipino and
English pronunciation must be inspected before GPU training.

## Environment

- English espeak status: `available`
- Spanish espeak status: `available`

## Early Findings

- Official StyleTTS2 demos use `phonemizer` plus `espeak-ng`; this is only a baseline for Taglish.
- Spanish espeak may sometimes look closer to Filipino vowel spelling, but it is not a Tagalog frontend.
- Character-based input is technically easy, but it changes alignment and PL-BERT assumptions.
- The proposed route is language-aware English + Filipino G2P into one shared representation.

## Required Word Probe

### `ng`

- Tokens: `['ng']`
- English espeak: `ˌɛnd‍ʒˈiː`
- Spanish espeak: `ˌenexˈe`
- Custom Taglish: `NG`

### `mga`

- Tokens: `['mga']`
- English espeak: `ˌɛmd‍ʒˌiːˈe‍ɪ`
- Spanish espeak: `ˌemexˌeˈa`
- Custom Taglish: `M A NG A`

### `kailangan`

- Tokens: `['kailangan']`
- English espeak: `kˈa‍ɪlæŋɡən`
- Spanish espeak: `ka‍ɪlˈaŋɡan`
- Custom Taglish: `K A I L A NG A N`

### `pwede`

- Tokens: `['pwede']`
- English espeak: `pˈiːwˈiːd`
- Spanish espeak: `pˈewˈeðe`
- Custom Taglish: `P W E D E`

### `puwede`

- Tokens: `['puwede']`
- English espeak: `pjˈuːwɛd`
- Spanish espeak: `puwˈeðe`
- Custom Taglish: `P U W E D E`

### `hindi`

- Tokens: `['hindi']`
- English espeak: `hˈɪndi`
- Spanish espeak: `ˈindi`
- Custom Taglish: `H I N D I`

### `ninyo`

- Tokens: `['ninyo']`
- English espeak: `nˈɪnɪˌo‍ʊ`
- Spanish espeak: `nˈiɲo`
- Custom Taglish: `N I N Y O`

### `natin`

- Tokens: `['natin']`
- English espeak: `nˈætɪn`
- Spanish espeak: `nˈatin`
- Custom Taglish: `N A T I N`

### `namin`

- Tokens: `['namin']`
- English espeak: `nˈæmɪn`
- Spanish espeak: `nˈamin`
- Custom Taglish: `N A M I N`

### `po`

- Tokens: `['po']`
- English espeak: `pˈo‍ʊ`
- Spanish espeak: `pˈo`
- Custom Taglish: `P O`

### `ba`

- Tokens: `['ba']`
- English espeak: `bˈɑː`
- Spanish espeak: `bˈa`
- Custom Taglish: `B A`

### `magkano`

- Tokens: `['magkano']`
- English espeak: `mæɡkˈɑːno‍ʊ`
- Spanish espeak: `maɡkˈano`
- Custom Taglish: `M A G K A N O`

### `salamat`

- Tokens: `['salamat']`
- English espeak: `sˈælɐmˌæt`
- Spanish espeak: `sˌalamˈat`
- Custom Taglish: `S A L A M A T`

## Sentence Audit

### 1. Kailangan po natin i-check ang account ninyo.

- Tokenized words: `['Kailangan', 'po', 'natin', 'i-check', 'ang', 'account', 'ninyo', '.']`
- English espeak: `kˈa‍ɪlæŋɡən pˈo‍ʊ nˈætɪn ˈa‍ɪt‍ʃˈɛk ˈæŋ ɐkˈa‍ʊnt nˈɪnɪˌo‍ʊ`
- Spanish espeak: `ka‍ɪlˈaŋɡam pˈo nˈatin ˈit‍ʃˈek ˈaŋ akkˈownt nˈiɲo`
- Character/token frontend: `K a i l a n g a n | p o | n a t i n | i - c h e c k | a n g | a c c o u n t | n i n y o | .`
- Custom language-aware frontend: `K A I L A NG A N | P O | N A T I N | I EN<check> | A NG | EN<account> | N I N Y O | .`
- Warnings: `['English stem needs English G2P', 'Route through English G2P in final frontend']`

### 2. Available po ba tomorrow?

- Tokenized words: `['Available', 'po', 'ba', 'tomorrow', '?']`
- English espeak: `ɐvˈe‍ɪləbə‍l pˈo‍ʊ bˈɑː təmˈɑːɹo‍ʊ`
- Spanish espeak: `ˌaβa‍ɪlˈaβle pˈo βˈa tˌomorˈow`
- Character/token frontend: `A v a i l a b l e | p o | b a | t o m o r r o w | ?`
- Custom language-aware frontend: `EN<available> | P O | B A | EN<tomorrow> | ?`
- Warnings: `['Route through English G2P in final frontend', 'Route through English G2P in final frontend']`

### 3. Pwede po nating schedule sa Friday.

- Tokenized words: `['Pwede', 'po', 'nating', 'schedule', 'sa', 'Friday', '.']`
- English espeak: `pˈiːwˈiːd pˈo‍ʊ nˈe‍ɪɾɪŋ skˈɛd‍ʒuːl sˈɑː fɹˈa‍ɪde‍ɪ`
- Spanish espeak: `pˈewˈeðe pˈo nˈatiŋ st‍ʃeðˈule sˈa fɾiðˈa‍ɪ`
- Character/token frontend: `P w e d e | p o | n a t i n g | s c h e d u l e | s a | F r i d a y | .`
- Custom language-aware frontend: `P W E D E | P O | N A T I NG | EN<schedule> | S A | EN<friday> | .`
- Warnings: `['Route through English G2P in final frontend', 'Route through English G2P in final frontend']`

### 4. May delivery po ba sa Quezon City?

- Tokenized words: `['May', 'delivery', 'po', 'ba', 'sa', 'Quezon', 'City', '?']`
- English espeak: `mˈe‍ɪ dᵻlˈɪvɚɹi pˈo‍ʊ bˈɑː sˈɑː kwˈɛzɑːn sˈɪɾi`
- Spanish espeak: `mˈa‍ɪ ðˌeliβˈeɾi pˈo βˈa sˈa kˈeθon θˈiti`
- Character/token frontend: `M a y | d e l i v e r y | p o | b a | s a | Q u e z o n | C i t y | ?`
- Custom language-aware frontend: `M A Y | EN<delivery> | P O | B A | S A | Q U E Z O N | EN<city> | ?`
- Warnings: `['Route through English G2P in final frontend', 'non-native Filipino letter `q` in `Quezon`; non-native Filipino letter `z` in `Quezon`', 'Route through English G2P in final frontend']`

### 5. The total amount is two thousand five hundred pesos.

- Tokenized words: `['The', 'total', 'amount', 'is', 'two', 'thousand', 'five', 'hundred', 'pesos', '.']`
- English espeak: `ðə tˈo‍ʊɾə‍l ɐmˈa‍ʊnt ɪz tˈuː θˈa‍ʊzənd fˈa‍ɪv hˈʌndɹɪd pˈe‍ɪso‍ʊz`
- Spanish espeak: `tˈe totˈal amˈownt ˈis tˌeˌuβe ðˌoβleˈo towsˈand fˈiβe undɾˈed pˈesos`
- Character/token frontend: `T h e | t o t a l | a m o u n t | i s | t w o | t h o u s a n d | f i v e | h u n d r e d | p e s o s | .`
- Custom language-aware frontend: `EN<the> | EN<total> | EN<amount> | EN<is> | EN<two> | EN<thousand> | EN<five> | EN<hundred> | P E S O S | .`
- Warnings: `['Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend']`

### 6. Hi po! We can book your appointment today.

- Tokenized words: `['Hi', 'po', '!', 'We', 'can', 'book', 'your', 'appointment', 'today', '.']`
- English espeak: `hˈa‍ɪ pˈo‍ʊ
wiː kæn bˈʊk jʊɹ ɐpˈɔ‍ɪntmənt tədˈe‍ɪ`
- Spanish espeak: `ˈi pˈo
wˈe kˈam boˈok ʝˈowɾ ˌappo‍ɪntmˈɛnt toðˈa‍ɪ`
- Character/token frontend: `H i | p o | ! | W e | c a n | b o o k | y o u r | a p p o i n t m e n t | t o d a y | .`
- Custom language-aware frontend: `EN<hi> | P O | ! | EN<we> | EN<can> | EN<book> | EN<your> | EN<appointment> | EN<today> | .`
- Warnings: `['Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend']`

### 7. Magkano po ang monthly package?

- Tokenized words: `['Magkano', 'po', 'ang', 'monthly', 'package', '?']`
- English espeak: `mæɡkˈɑːno‍ʊ pˈo‍ʊ ˈæŋ mˈʌnθli pˈækɪd‍ʒ`
- Spanish espeak: `maɡkˈano pˈo ˈaŋ mˈontli pakˈaxe`
- Character/token frontend: `M a g k a n o | p o | a n g | m o n t h l y | p a c k a g e | ?`
- Custom language-aware frontend: `M A G K A N O | P O | A NG | EN<monthly> | EN<package> | ?`
- Warnings: `['Route through English G2P in final frontend', 'Route through English G2P in final frontend']`

### 8. Let me check po kung available pa ang unit.

- Tokenized words: `['Let', 'me', 'check', 'po', 'kung', 'available', 'pa', 'ang', 'unit', '.']`
- English espeak: `lˈɛt mˌiː t‍ʃˈɛk pˈo‍ʊ kˈʌŋ ɐvˈe‍ɪləbə‍l pˈɑː ˈæŋ jˈuːnɪt`
- Spanish espeak: `lˈet me t‍ʃˈek pˈo kˈuŋ ˌaβa‍ɪlˈaβle pˈa ˈaŋ unˈit`
- Character/token frontend: `L e t | m e | c h e c k | p o | k u n g | a v a i l a b l e | p a | a n g | u n i t | .`
- Custom language-aware frontend: `EN<let> | EN<me> | EN<check> | P O | K U NG | EN<available> | P A | A NG | EN<unit> | .`
- Warnings: `['Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend']`

### 9. Pwede po ba credit card?

- Tokenized words: `['Pwede', 'po', 'ba', 'credit', 'card', '?']`
- English espeak: `pˈiːwˈiːd pˈo‍ʊ bˈɑː kɹˈɛdɪt kˈɑː‍ɹd`
- Spanish espeak: `pˈewˈeðe pˈo βˈa kɾeðˈit kˈaɾd`
- Character/token frontend: `P w e d e | p o | b a | c r e d i t | c a r d | ?`
- Custom language-aware frontend: `P W E D E | P O | B A | EN<credit> | EN<card> | ?`
- Warnings: `['Route through English G2P in final frontend', 'Route through English G2P in final frontend']`

### 10. Your appointment is confirmed for Monday at three PM.

- Tokenized words: `['Your', 'appointment', 'is', 'confirmed', 'for', 'Monday', 'at', 'three', 'PM', '.']`
- English espeak: `jʊɹ ɐpˈɔ‍ɪntmənt ɪz kənfˈɜːmd fɔː‍ɹ mˈʌnde‍ɪ æt θɹˈiː pˌiːˈɛm`
- Spanish espeak: `ʝˈowɾ ˌappo‍ɪntmˈɛnt ˈis kˌonfiɾmˈed fˈoɾ mondˈa‍ɪ ˈat tɾˈee pˌeˈɛme`
- Character/token frontend: `Y o u r | a p p o i n t m e n t | i s | c o n f i r m e d | f o r | M o n d a y | a t | t h r e e | P M | .`
- Custom language-aware frontend: `EN<your> | EN<appointment> | EN<is> | EN<confirmed> | EN<for> | EN<monday> | EN<at> | EN<three> | EN<pm> | .`
- Warnings: `['Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend']`

### 11. Pasensya na po ulit sa naging abala kanina, salamat sa pag-unawa ninyo.

- Tokenized words: `['Pasensya', 'na', 'po', 'ulit', 'sa', 'naging', 'abala', 'kanina', ',', 'salamat', 'sa', 'pag-unawa', 'ninyo', '.']`
- English espeak: `pˈe‍ɪsənsɪə nˈɑː pˈo‍ʊ ˈuːlɪt sˈɑː nˈe‍ɪd‍ʒɪŋ ɐbˈɑːlə kˈænɪnə
sˈælɐmˌæt sˈɑː pˈæɡʌnɐwˈæ nˈɪnɪˌo‍ʊ`
- Spanish espeak: `pasˈɛnsʝa nˈa pˈo ulˈit sˈa nˈaxiŋ aβˈala kanˈina
sˌalamˈat sˈa pˈaxinaunˈawa nˈiɲo`
- Character/token frontend: `P a s e n s y a | n a | p o | u l i t | s a | n a g i n g | a b a l a | k a n i n a | , | s a l a m a t | s a | p a g - u n a w a | n i n y o | .`
- Custom language-aware frontend: `P A S E N S Y A | N A | P O | U L I T | S A | N A G I NG | A B A L A | K A N I N A | , | S A L A M A T | S A | P A G U N A W A | N I N Y O | .`

### 12. We apologize again for the slight delay during our call today.

- Tokenized words: `['We', 'apologize', 'again', 'for', 'the', 'slight', 'delay', 'during', 'our', 'call', 'today', '.']`
- English espeak: `wiː ɐpˈɑːləd‍ʒˌa‍ɪz ɐɡˈɛn fɚðə slˈa‍ɪt dᵻlˈe‍ɪ dˈʊ‍ɹɹɪŋ ˌa‍ʊɚ kˈɔːl tədˈe‍ɪ`
- Spanish espeak: `wˈe ˌapoloxˈiθe ˈaɣa‍ɪn fˈoɾ tˈe slˈiɣt ðelˈa‍ɪ ðˈuɾiŋ ˈowɾ kˈaʎ toðˈa‍ɪ`
- Character/token frontend: `W e | a p o l o g i z e | a g a i n | f o r | t h e | s l i g h t | d e l a y | d u r i n g | o u r | c a l l | t o d a y | .`
- Custom language-aware frontend: `EN<we> | EN<apologize> | EN<again> | EN<for> | EN<the> | EN<slight> | EN<delay> | EN<during> | EN<our> | EN<call> | EN<today> | .`
- Warnings: `['Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend']`

### 13. Sorry po kung medyo natagalan ang pag-process natin ng inyong order.

- Tokenized words: `['Sorry', 'po', 'kung', 'medyo', 'natagalan', 'ang', 'pag-process', 'natin', 'ng', 'inyong', 'order', '.']`
- English espeak: `sˈɑːɹi pˈo‍ʊ kˈʌŋ mˈɛdɪˌo‍ʊ nˈæɾɐɡˌælæn ˈæŋ pˈæɡpɹˈɑːsɛs nˈætɪn ˌɛnd‍ʒˈiː ɪnjˈɑːŋ ˈɔː‍ɹdɚ`
- Spanish espeak: `sˈori pˈo kˈuŋ mˈeðʝo nˌataɣˈalan ˈaŋ pˈaxinapɾoθˈess nˈatin ˌenexˈe ˈiɲoŋ oɾðˈeɾ`
- Character/token frontend: `S o r r y | p o | k u n g | m e d y o | n a t a g a l a n | a n g | p a g - p r o c e s s | n a t i n | n g | i n y o n g | o r d e r | .`
- Custom language-aware frontend: `S O R R Y | P O | K U NG | M E D Y O | N A T A G A L A N | A NG | P A G EN<process> | N A T I N | NG | I N Y O NG | O R D E R | .`
- Warnings: `['English stem needs English G2P']`

### 14. Your final total is exactly one thousand two hundred fifty pesos today.

- Tokenized words: `['Your', 'final', 'total', 'is', 'exactly', 'one', 'thousand', 'two', 'hundred', 'fifty', 'pesos', 'today', '.']`
- English espeak: `jʊ‍ɹ fˈa‍ɪnə‍l tˈo‍ʊɾə‍l ɪz ɛɡzˈæktli wˈʌn θˈa‍ʊzənd tˈuː hˈʌndɹɪd fˈɪfti pˈe‍ɪso‍ʊz tədˈe‍ɪ`
- Spanish espeak: `ʝˈowɾ finˈal totˈal ˈis eksˈaktli ˈone towsˈand tˌeˌuβe ðˌoβleˈo undɾˈed fˈifti pˈesos toðˈa‍ɪ`
- Character/token frontend: `Y o u r | f i n a l | t o t a l | i s | e x a c t l y | o n e | t h o u s a n d | t w o | h u n d r e d | f i f t y | p e s o s | t o d a y | .`
- Custom language-aware frontend: `EN<your> | EN<final> | EN<total> | EN<is> | EN<exactly> | O N E | EN<thousand> | EN<two> | EN<hundred> | EN<fifty> | P E S O S | EN<today> | .`
- Warnings: `['Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend']`

### 15. Thank you so much for choosing our store for your shopping today!

- Tokenized words: `['Thank', 'you', 'so', 'much', 'for', 'choosing', 'our', 'store', 'for', 'your', 'shopping', 'today', '!']`
- English espeak: `θˈæŋk juː sˈo‍ʊ mˌʌt‍ʃ fɔː‍ɹ t‍ʃˈuːzɪŋ ˌa‍ʊɚ stˈɔː‍ɹ fɔː‍ɹ jʊ‍ɹ ʃˈɑːpɪŋ tədˈe‍ɪ`
- Spanish espeak: `tˈaŋk ʝˈow sˈo mˈut‍ʃ fˈoɾ t‍ʃoˈosiŋ ˈowɾ stˈoɾe fˈoɾ ʝˈowɾ ʃˈoppiŋ toðˈa‍ɪ`
- Character/token frontend: `T h a n k | y o u | s o | m u c h | f o r | c h o o s i n g | o u r | s t o r e | f o r | y o u r | s h o p p i n g | t o d a y | !`
- Custom language-aware frontend: `T H A N K | Y O U | S O | EN<much> | EN<for> | EN<choosing> | EN<our> | S T O R E | EN<for> | EN<your> | SY O P P I NG | EN<today> | !`
- Warnings: `['Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend']`

### 16. I am truly sorry for the inconvenience, but thank you for ordering.

- Tokenized words: `['I', 'am', 'truly', 'sorry', 'for', 'the', 'inconvenience', ',', 'but', 'thank', 'you', 'for', 'ordering', '.']`
- English espeak: `a‍ɪɐm tɹˈuːli sˈɑːɹi fɚðɪ ɪŋkənvˈiːnɪəns
bˌʌt θˈæŋk juː fɔːɹ ˈɔː‍ɹdɚɹɪŋ`
- Spanish espeak: `ˈi ˈam tɾˈuli sˈori fˈoɾ tˈe ˌinkombenjˈɛnθe
bˈut tˈaŋk ʝˈow fˈoɾ oɾðˈeɾiŋ`
- Character/token frontend: `I | a m | t r u l y | s o r r y | f o r | t h e | i n c o n v e n i e n c e | , | b u t | t h a n k | y o u | f o r | o r d e r i n g | .`
- Custom language-aware frontend: `I | A M | T R U L Y | S O R R Y | EN<for> | EN<the> | EN<inconvenience> | , | B U T | T H A N K | Y O U | EN<for> | O R D E R I NG | .`
- Warnings: `['Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend']`

### 17. Paumanhin po sa anumang pagkukulang, asahan ninyong pagbubutihin pa namin ito.

- Tokenized words: `['Paumanhin', 'po', 'sa', 'anumang', 'pagkukulang', ',', 'asahan', 'ninyong', 'pagbubutihin', 'pa', 'namin', 'ito', '.']`
- English espeak: `pˈɔːmɐnhˌɪn pˈo‍ʊ sˈɑː ˈænuːmˌæŋ pˈæɡkjuːkjˌʊlæŋ
ɐsˈæhæn nˈɪnɪˌɑːŋ pˈæɡbjuːbjˌuːɾɪhˌɪn pˈɑː nˈæmɪn ˈiːɾo‍ʊ`
- Spanish espeak: `pa‍ʊmˈanim pˈo sˈa anˈumaŋ pˌaɡkukˈulaŋ
asˈaan nˈiɲoŋ pˌaɡβuβutˈiim pˈa nˈamin ˈito`
- Character/token frontend: `P a u m a n h i n | p o | s a | a n u m a n g | p a g k u k u l a n g | , | a s a h a n | n i n y o n g | p a g b u b u t i h i n | p a | n a m i n | i t o | .`
- Custom language-aware frontend: `P A U M A N H I N | P O | S A | A N U M A NG | P A G K U K U L A NG | , | A S A H A N | N I N Y O NG | P A G B U B U T I H I N | P A | N A M I N | I T O | .`

### 18. Wag po kayong mag-alala, babantayan ko mismo ang inyong order hanggang dumating.

- Tokenized words: `['Wag', 'po', 'kayong', 'mag-alala', ',', 'babantayan', 'ko', 'mismo', 'ang', 'inyong', 'order', 'hanggang', 'dumating', '.']`
- English espeak: `wˈæɡ pˈo‍ʊ kˈe‍ɪɑːŋ mˈæɡɐlˈɑːlə
bˈæbɐntˌe‍ɪən kˈo‍ʊ mɪsmˈo‍ʊ ˈæŋ ɪnjˈɑːŋ ˈɔː‍ɹdɚ hˈæŋɡæŋ dˈuːme‍ɪɾɪŋ`
- Spanish espeak: `wˈaɡ pˈo kˈaʝoŋ mˈaɣalˈala
bˌaβantˈaʝaŋ kˈo mˈismo ˈaŋ ˈiɲoŋ oɾðˈeɾ ˈaŋɡɣaŋ dumˈatiŋ`
- Character/token frontend: `W a g | p o | k a y o n g | m a g - a l a l a | , | b a b a n t a y a n | k o | m i s m o | a n g | i n y o n g | o r d e r | h a n g g a n g | d u m a t i n g | .`
- Custom language-aware frontend: `W A G | P O | K A Y O NG | M A G A L A L A | , | B A B A N T A Y A N | K O | M I S M O | A NG | I N Y O NG | O R D E R | H A NG G A NG | D U M A T I NG | .`

### 19. Rest assured that your package will be delivered safely right to your doorstep.

- Tokenized words: `['Rest', 'assured', 'that', 'your', 'package', 'will', 'be', 'delivered', 'safely', 'right', 'to', 'your', 'doorstep', '.']`
- English espeak: `ɹˈɛst əʃˈʊ‍ɹd ðæt jʊ‍ɹ pˈækɪd‍ʒ wɪl biː dᵻlˈɪvɚd sˈe‍ɪfli ɹˈa‍ɪt tə jʊ‍ɹ dˈɔː‍ɹstɛp`
- Spanish espeak: `rˈest ˌassuɾˈed tˈat ʝˈowɾ pakˈaxe wˈiʎ βˈe ðˌeliβeɾˈed safˈeli rˈiɣt tˈo ʝˈowɾ ðˌooɾstˈep`
- Character/token frontend: `R e s t | a s s u r e d | t h a t | y o u r | p a c k a g e | w i l l | b e | d e l i v e r e d | s a f e l y | r i g h t | t o | y o u r | d o o r s t e p | .`
- Custom language-aware frontend: `R E S T | A S S U R E D | T H A T | EN<your> | EN<package> | W I L L | B E | EN<delivered> | EN<safely> | R I G H T | T O | EN<your> | D O O R S T E P | .`
- Warnings: `['Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend']`

### 20. Sigurado pong matatanggap ninyo nang maayos ang lahat ng inyong binili ngayon.

- Tokenized words: `['Sigurado', 'pong', 'matatanggap', 'ninyo', 'nang', 'maayos', 'ang', 'lahat', 'ng', 'inyong', 'binili', 'ngayon', '.']`
- English espeak: `sˌɪɡjʊ‍ɹɹˈɑːdo‍ʊ pˈɑːŋ mˈæɾɐtˌæŋɡæp nˈɪnɪˌo‍ʊ nˈæŋ mˈɑːjo‍ʊz ˈæŋ lˈæhæt ˌɛnd‍ʒˈiː ɪnjˈɑːŋ ba‍ɪnˈɪli əŋɡˈe‍ɪən`
- Spanish espeak: `sˌiɣuɾˈaðo pˈoŋ mˌatataŋɡɣˈap nˈiɲo nˈaŋ maˈaʝos ˈaŋ laˈat ˌenexˈe ˈiɲoŋ binˈili ˈɛneɣˈaʝon`
- Character/token frontend: `S i g u r a d o | p o n g | m a t a t a n g g a p | n i n y o | n a n g | m a a y o s | a n g | l a h a t | n g | i n y o n g | b i n i l i | n g a y o n | .`
- Custom language-aware frontend: `S I G U R A D O | P O NG | M A T A T A NG G A P | N I N Y O | N A NG | M A A Y O S | A NG | L A H A T | NG | I N Y O NG | B I N I L I | NG A Y O N | .`

### 21. I assure you that everything is completely finalized and ready for dispatch.

- Tokenized words: `['I', 'assure', 'you', 'that', 'everything', 'is', 'completely', 'finalized', 'and', 'ready', 'for', 'dispatch', '.']`
- English espeak: `a‍ɪ əʃˈʊ‍ɹ juː ðæt ˈɛvɹɪθˌɪŋ ɪz kəmplˈiːtli fˈa‍ɪnə‍lˌa‍ɪzd ænd ɹˈɛdi fɔː‍ɹ dɪspˈæt‍ʃ`
- Spanish espeak: `ˈi assˈuɾe ʝˈow tˈat ˌeβeɾˈitiŋ ˈis kˌompletˈeli fˌinaliθˈeð ˈand reˈaði fˈoɾ ðispˈatt‍ʃ`
- Character/token frontend: `I | a s s u r e | y o u | t h a t | e v e r y t h i n g | i s | c o m p l e t e l y | f i n a l i z e d | a n d | r e a d y | f o r | d i s p a t c h | .`
- Custom language-aware frontend: `I | A S S U R E | Y O U | T H A T | EN<everything> | EN<is> | EN<completely> | EN<finalized> | A N D | R E A D Y | EN<for> | EN<dispatch> | .`
- Warnings: `['Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend']`

### 22. Makakaasa po kayong maipapadala agad namin ito bukas na bukas din.

- Tokenized words: `['Makakaasa', 'po', 'kayong', 'maipapadala', 'agad', 'namin', 'ito', 'bukas', 'na', 'bukas', 'din', '.']`
- English espeak: `mˈækɐkˌɑːsə pˈo‍ʊ kˈe‍ɪɑːŋ mˌe‍ɪpɐpɐdˈɑːlə ˈæɡæd nˈæmɪn ˈiːɾo‍ʊ bjˈuːkəz nˈɑː bjˈuːkəz dˈɪn`
- Spanish espeak: `mˌakakaˈasa pˈo kˈaʝoŋ mˌa‍ɪpapaðˈala aɣˈad nˈamin ˈito βˈukas nˈa βˈukas ðˈin`
- Character/token frontend: `M a k a k a a s a | p o | k a y o n g | m a i p a p a d a l a | a g a d | n a m i n | i t o | b u k a s | n a | b u k a s | d i n | .`
- Custom language-aware frontend: `M A K A K A A S A | P O | K A Y O NG | M A I P A P A D A L A | A G A D | N A M I N | I T O | B U K A S | N A | B U K A S | D I N | .`

### 23. Babasahin ko lang po ulit ang inyong order para makasiguro tayo.

- Tokenized words: `['Babasahin', 'ko', 'lang', 'po', 'ulit', 'ang', 'inyong', 'order', 'para', 'makasiguro', 'tayo', '.']`
- English espeak: `bˈæbɐsˌæhɪn kˈo‍ʊ lˈæŋ pˈo‍ʊ ˈuːlɪt ˈæŋ ɪnjˈɑːŋ ˈɔː‍ɹdɚ pˈæɹə mˌækɐsɪɡjˈʊ‍ɹɹo‍ʊ tˈe‍ɪo‍ʊ`
- Spanish espeak: `bˌaβasˈaiŋ kˈo lˈaŋ pˈo ulˈit ˈaŋ ˈiɲoŋ oɾðˈeɾ pˌaɾa mˌakasiɣˈuɾo tˈaʝo`
- Character/token frontend: `B a b a s a h i n | k o | l a n g | p o | u l i t | a n g | i n y o n g | o r d e r | p a r a | m a k a s i g u r o | t a y o | .`
- Custom language-aware frontend: `B A B A S A H I N | K O | L A NG | P O | U L I T | A NG | I N Y O NG | O R D E R | P A R A | M A K A S I G U R O | T A Y O | .`

### 24. Let me read back ang inyong complete delivery details bago tayo mag-end.

- Tokenized words: `['Let', 'me', 'read', 'back', 'ang', 'inyong', 'complete', 'delivery', 'details', 'bago', 'tayo', 'mag-end', '.']`
- English espeak: `lˈɛt mˌiː ɹˈiːd bˈæk ˈæŋ ɪnjˈɑːŋ kəmplˈiːt dᵻlˈɪvɚɹi diːtˈe‍ɪlz bˈe‍ɪɡo‍ʊ tˈe‍ɪo‍ʊ mˈæɡˈɛnd`
- Spanish espeak: `lˈet me reˈad βˈak ˈaŋ ˈiɲoŋ komplˈete ðˌeliβˈeɾi ðetˈa‍ɪls βˈaɣo tˈaʝo mˈaɣˈɛnd`
- Character/token frontend: `L e t | m e | r e a d | b a c k | a n g | i n y o n g | c o m p l e t e | d e l i v e r y | d e t a i l s | b a g o | t a y o | m a g - e n d | .`
- Custom language-aware frontend: `EN<let> | EN<me> | R E A D | EN<back> | A NG | I N Y O NG | EN<complete> | EN<delivery> | D E T A I L S | B A G O | T A Y O | M A G E N D | .`
- Warnings: `['Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend']`

### 25. Uulitin ko po, dalawang malaking t-shirt na kulay itim ang inyong kinuha.

- Tokenized words: `['Uulitin', 'ko', 'po', ',', 'dalawang', 'malaking', 't-shirt', 'na', 'kulay', 'itim', 'ang', 'inyong', 'kinuha', '.']`
- English espeak: `ˈuːlɪtˌɪn kˈo‍ʊ pˈo‍ʊ
dˈælɐwˌæŋ mˈæle‍ɪkɪŋ tˈiːʃˈɜːt nˈɑː kjˈʊle‍ɪ ˈɪɾɪm ˈæŋ ɪnjˈɑːŋ kˈɪnuːhə`
- Spanish espeak: `ˌuulˈitiŋ kˈo pˈo
dalˈawaŋ malˈakiŋ tˈeʃˈiɾt nˈa kulˈa‍ɪ ˈitim ˈaŋ ˈiɲoŋ kinˈua`
- Character/token frontend: `U u l i t i n | k o | p o | , | d a l a w a n g | m a l a k i n g | t - s h i r t | n a | k u l a y | i t i m | a n g | i n y o n g | k i n u h a | .`
- Custom language-aware frontend: `U U L I T I N | K O | P O | , | D A L A W A NG | M A L A K I NG | T SY I R T | N A | K U L A Y | I T I M | A NG | I N Y O NG | K I N U H A | .`

### 26. I-confirm ko lang po ang inyong address, ito ay sa quezon city.

- Tokenized words: `['I-confirm', 'ko', 'lang', 'po', 'ang', 'inyong', 'address', ',', 'ito', 'ay', 'sa', 'quezon', 'city', '.']`
- English espeak: `a‍ɪkənfˈɜːm kˈo‍ʊ lˈæŋ pˈo‍ʊ ˈæŋ ɪnjˈɑːŋ ɐdɹˈɛs
ˈiːɾo‍ʊ ˈa‍ɪ sˈɑː kwˈɛzɑːn sˈɪɾi`
- Spanish espeak: `ˈikonfˈiɾm kˈo lˈaŋ pˈo ˈaŋ ˈiɲoŋ adðɾˈess
ˈito ˈa‍ɪ sˈa kˈeθon θˈiti`
- Character/token frontend: `I - c o n f i r m | k o | l a n g | p o | a n g | i n y o n g | a d d r e s s | , | i t o | a y | s a | q u e z o n | c i t y | .`
- Custom language-aware frontend: `I EN<confirm> | K O | L A NG | P O | A NG | I N Y O NG | A D D R E S S | , | I T O | A Y | S A | Q U E Z O N | EN<city> | .`
- Warnings: `['English stem needs English G2P', 'non-native Filipino letter `q` in `quezon`; non-native Filipino letter `z` in `quezon`', 'Route through English G2P in final frontend']`

### 27. Paki-check po ang inyong telepono mamaya para sa official text ng courier.

- Tokenized words: `['Paki-check', 'po', 'ang', 'inyong', 'telepono', 'mamaya', 'para', 'sa', 'official', 'text', 'ng', 'courier', '.']`
- English espeak: `pˈækit‍ʃˈɛk pˈo‍ʊ ˈæŋ ɪnjˈɑːŋ tˌɛlᵻpˈo‍ʊno‍ʊ mˈæme‍ɪə pˈæɹə sˈɑː əfˈɪʃə‍l tˈɛkst ˌɛnd‍ʒˈiː kˈɜːɹiɚ`
- Spanish espeak: `pˈakit‍ʃˈek pˈo ˈaŋ ˈiɲoŋ tˌelepˈono mamˈaʝa pˌaɾa sˈa ˌoffiθjˈal tˈekst ˌenexˈe kowɾjˈeɾ`
- Character/token frontend: `P a k i - c h e c k | p o | a n g | i n y o n g | t e l e p o n o | m a m a y a | p a r a | s a | o f f i c i a l | t e x t | n g | c o u r i e r | .`
- Custom language-aware frontend: `EN<paki-check> | P O | A NG | I N Y O NG | T E L E P O N O | M A M A Y A | P A R A | S A | EN<official> | EN<text> | NG | EN<courier> | .`
- Warnings: `['Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend']`

### 28. Isasara ko na po ang transaction natin para sa araw na ito.

- Tokenized words: `['Isasara', 'ko', 'na', 'po', 'ang', 'transaction', 'natin', 'para', 'sa', 'araw', 'na', 'ito', '.']`
- English espeak: `ˌɪsɐsˈɑː‍ɹɹə kˈo‍ʊ nˈɑː pˈo‍ʊ ˈæŋ tɹænsˈækʃən nˈætɪn pˈæɹə sˈɑː ˈæɹɔː nˈɑː ˈiːɾo‍ʊ`
- Spanish espeak: `ˌisasˈaɾa kˈo nˈa pˈo ˈaŋ tɾansˈaktjon nˈatim pˌaɾa sˈa aɾˈaw nˈa ˈito`
- Character/token frontend: `I s a s a r a | k o | n a | p o | a n g | t r a n s a c t i o n | n a t i n | p a r a | s a | a r a w | n a | i t o | .`
- Custom language-aware frontend: `I S A S A R A | K O | N A | P O | A NG | EN<transaction> | N A T I N | P A R A | S A | A R A W | N A | I T O | .`
- Warnings: `['Route through English G2P in final frontend']`

### 29. Ipapasok ko na po ang mga detalye ninyo sa aming system ngayon.

- Tokenized words: `['Ipapasok', 'ko', 'na', 'po', 'ang', 'mga', 'detalye', 'ninyo', 'sa', 'aming', 'system', 'ngayon', '.']`
- English espeak: `ˈɪpɐpˌæsɑːk kˈo‍ʊ nˈɑː pˈo‍ʊ ˈæŋ ˌɛmd‍ʒˌiːˈe‍ɪ dɪtˈæla‍ɪ nˈɪnɪˌo‍ʊ sˈɑː ˈe‍ɪmɪŋ sˈɪstəm əŋɡˈe‍ɪən`
- Spanish espeak: `ˌipapasˈok kˈo nˈa pˈo ˈaŋ ˌemexˌeˈa ðetˈalʝe nˈiɲo sˈa ˈamiŋ sˈistem ˈɛneɣˈaʝon`
- Character/token frontend: `I p a p a s o k | k o | n a | p o | a n g | m g a | d e t a l y e | n i n y o | s a | a m i n g | s y s t e m | n g a y o n | .`
- Custom language-aware frontend: `I P A P A S O K | K O | N A | P O | A NG | M A NG A | D E T A L Y E | N I N Y O | S A | A M I NG | S Y S T E M | NG A Y O N | .`

### 30. Please expect a confirmation email containing your digital receipt later this afternoon.

- Tokenized words: `['Please', 'expect', 'a', 'confirmation', 'email', 'containing', 'your', 'digital', 'receipt', 'later', 'this', 'afternoon', '.']`
- English espeak: `plˈiːz ɛkspˈɛkt ɐ kɑːnfɚmˈe‍ɪʃən ˈiːme‍ɪl kəntˈe‍ɪnɪŋ jʊ‍ɹ dˈɪd‍ʒɪɾə‍l ɹᵻsˈiːt lˈe‍ɪɾɚ ðɪs ˌæftɚnˈuːn`
- Spanish espeak: `pleˈase ekspˈekt a kˌonfiɾmˈatjon emˈa‍ɪl kontˈa‍ɪniŋ ʝˈowɾ ðˌixitˈal reθˈe‍ɪpːt latˈeɾ tˈis ˌafteɾnˈoon`
- Character/token frontend: `P l e a s e | e x p e c t | a | c o n f i r m a t i o n | e m a i l | c o n t a i n i n g | y o u r | d i g i t a l | r e c e i p t | l a t e r | t h i s | a f t e r n o o n | .`
- Custom language-aware frontend: `P L E A S E | EN<expect> | A | EN<confirmation> | E M A I L | EN<containing> | EN<your> | D I G I T A L | EN<receipt> | L A T E R | T H I S | EN<afternoon> | .`
- Warnings: `['Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend']`

### 31. Bale pito po lahat ang items na ipadadala namin sa inyong bahay.

- Tokenized words: `['Bale', 'pito', 'po', 'lahat', 'ang', 'items', 'na', 'ipadadala', 'namin', 'sa', 'inyong', 'bahay', '.']`
- English espeak: `bˈe‍ɪl pˈiːɾo‍ʊ pˈo‍ʊ lˈæhæt ˈæŋ ˈa‍ɪɾəmz nˈɑː ˌɪpɐdɐdˈɑːlə nˈæmɪn sˈɑː ɪnjˈɑːŋ bˈæhe‍ɪ`
- Spanish espeak: `bˈale pˈito pˈo laˈat ˈaŋ ˈitems nˈa ˌipaðaðˈala nˈamin sˈa ˈiɲoŋ baˈa‍ɪ`
- Character/token frontend: `B a l e | p i t o | p o | l a h a t | a n g | i t e m s | n a | i p a d a d a l a | n a m i n | s a | i n y o n g | b a h a y | .`
- Custom language-aware frontend: `B A L E | P I T O | P O | L A H A T | A NG | I T E M S | N A | I P A D A D A L A | N A M I N | S A | I N Y O NG | B A H A Y | .`

### 32. Kumpirmahin po natin ang inyong pangalan at contact number bago ibaba ang linya.

- Tokenized words: `['Kumpirmahin', 'po', 'natin', 'ang', 'inyong', 'pangalan', 'at', 'contact', 'number', 'bago', 'ibaba', 'ang', 'linya', '.']`
- English espeak: `kˈʌmpɚmˌæhɪn pˈo‍ʊ nˈætɪn ˈæŋ ɪnjˈɑːŋ pˈæŋɡɐlˌæn æt kˈɑːntækt nˈʌmbɚ bˈe‍ɪɡo‍ʊ a‍ɪbˈɑːbə ˈæŋ lˈɪnjə`
- Spanish espeak: `kˌumpiɾmˈaim pˈo nˈatin ˈaŋ ˈiɲoŋ paŋɡˈalan ˈat kontˈakt numbˈeɾ βˈaɣo iβˈaβa ˈaŋ lˈiɲa`
- Character/token frontend: `K u m p i r m a h i n | p o | n a t i n | a n g | i n y o n g | p a n g a l a n | a t | c o n t a c t | n u m b e r | b a g o | i b a b a | a n g | l i n y a | .`
- Custom language-aware frontend: `K U M P I R M A H I N | P O | N A T I N | A NG | I N Y O NG | P A NG A L A N | EN<at> | EN<contact> | N U M B E R | B A G O | I B A B A | A NG | L I N Y A | .`
- Warnings: `['Route through English G2P in final frontend', 'Route through English G2P in final frontend']`

### 33. Naka-record na po ang inyong request kaya wala na po kayong gagawin.

- Tokenized words: `['Naka-record', 'na', 'po', 'ang', 'inyong', 'request', 'kaya', 'wala', 'na', 'po', 'kayong', 'gagawin', '.']`
- English espeak: `nˈɑːkɚɹˈɛkɚd nˈɑː pˈo‍ʊ ˈæŋ ɪnjˈɑːŋ ɹᵻkwˈɛst kˈɑːjə wˈɑːlə nˈɑː pˈo‍ʊ kˈe‍ɪɑːŋ ɡˈæɡɐwˌɪn`
- Spanish espeak: `nˈakarekˈoɾd nˈa pˈo ˈaŋ ˈiɲoŋ rekˈest kˈaʝa wˈala nˈa pˈo kˈaʝoŋ ɡaɣˈawin`
- Character/token frontend: `N a k a - r e c o r d | n a | p o | a n g | i n y o n g | r e q u e s t | k a y a | w a l a | n a | p o | k a y o n g | g a g a w i n | .`
- Custom language-aware frontend: `N A K A EN<record> | N A | P O | A NG | I N Y O NG | EN<request> | K A Y A | W A L A | N A | P O | K A Y O NG | G A G A W I N | .`
- Warnings: `['English stem needs English G2P', 'Route through English G2P in final frontend']`

### 34. I will process the invoice pagkatapos na pagkatapos ng ating pag-uusap ngayon.

- Tokenized words: `['I', 'will', 'process', 'the', 'invoice', 'pagkatapos', 'na', 'pagkatapos', 'ng', 'ating', 'pag-uusap', 'ngayon', '.']`
- English espeak: `a‍ɪ wɪl pɹˈɑːsɛs ðɪ ˈɪnvɔ‍ɪs pˌæɡkɐtˈɑːpo‍ʊz nˈɑː pˌæɡkɐtˈɑːpo‍ʊz ˌɛnd‍ʒˈiː ˈe‍ɪɾɪŋ pˈæɡˈuːsæp əŋɡˈe‍ɪən`
- Spanish espeak: `ˈi wˈiʎ pɾoθˈess tˈe imbˈo‍ɪθe pˌaɡkatˈapos nˈa pˌaɡkatˈapos ˌenexˈe ˈatiŋ pˈaxinaˌuusˈap ˈɛneɣˈaʝon`
- Character/token frontend: `I | w i l l | p r o c e s s | t h e | i n v o i c e | p a g k a t a p o s | n a | p a g k a t a p o s | n g | a t i n g | p a g - u u s a p | n g a y o n | .`
- Custom language-aware frontend: `I | W I L L | EN<process> | EN<the> | EN<invoice> | P A G K A T A P O S | N A | P A G K A T A P O S | NG | A T I NG | P A G U U S A P | NG A Y O N | .`
- Warnings: `['Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend']`

### 35. Three hundred po ang inyong sukli na ibibigay ng rider bukas.

- Tokenized words: `['Three', 'hundred', 'po', 'ang', 'inyong', 'sukli', 'na', 'ibibigay', 'ng', 'rider', 'bukas', '.']`
- English espeak: `θɹˈiː hˈʌndɹɪd pˈo‍ʊ ˈæŋ ɪnjˈɑːŋ sˈʌkli nˈɑː ˈa‍ɪbɪbˌɪɡe‍ɪ ˌɛnd‍ʒˈiː ɹˈa‍ɪdɚ bjˈuːkəz`
- Spanish espeak: `tɾˈee undɾˈed pˈo ˈaŋ ˈiɲoŋ sˈukli nˈa ˌiβiβiɣˈa‍ɪ ˌenexˈe riðˈeɾ βˈukas`
- Character/token frontend: `T h r e e | h u n d r e d | p o | a n g | i n y o n g | s u k l i | n a | i b i b i g a y | n g | r i d e r | b u k a s | .`
- Custom language-aware frontend: `EN<three> | EN<hundred> | P O | A NG | I N Y O NG | S U K L I | N A | I B I B I G A Y | NG | R I D E R | B U K A S | .`
- Warnings: `['Route through English G2P in final frontend', 'Route through English G2P in final frontend']`

### 36. Hanggang dito na lang po muna ang ating pag-uusap tungkol sa order ninyo.

- Tokenized words: `['Hanggang', 'dito', 'na', 'lang', 'po', 'muna', 'ang', 'ating', 'pag-uusap', 'tungkol', 'sa', 'order', 'ninyo', '.']`
- English espeak: `hˈæŋɡæŋ dˈiːɾo‍ʊ nˈɑː lˈæŋ pˈo‍ʊ mˈuːnə ˈæŋ ˈe‍ɪɾɪŋ pˈæɡˈuːsæp tˈʌŋkɑːl sˈɑː ˈɔː‍ɹdɚ nˈɪnɪˌo‍ʊ`
- Spanish espeak: `ˈaŋɡɣaŋ dˈito nˈa lˈaŋ pˈo mˈuna ˈaŋ ˈatiŋ pˈaxinaˌuusˈap tuŋɡkˈol sˈa oɾðˈeɾ nˈiɲo`
- Character/token frontend: `H a n g g a n g | d i t o | n a | l a n g | p o | m u n a | a n g | a t i n g | p a g - u u s a p | t u n g k o l | s a | o r d e r | n i n y o | .`
- Custom language-aware frontend: `H A NG G A NG | D I T O | N A | L A NG | P O | M U N A | A NG | A T I NG | P A G U U S A P | T U NG K O L | S A | O R D E R | N I N Y O | .`

### 37. Nakuha ko na po ang lahat ng kailangan kong impormasyon mula sa inyo.

- Tokenized words: `['Nakuha', 'ko', 'na', 'po', 'ang', 'lahat', 'ng', 'kailangan', 'kong', 'impormasyon', 'mula', 'sa', 'inyo', '.']`
- English espeak: `nˈækjuːhə kˈo‍ʊ nˈɑː pˈo‍ʊ ˈæŋ lˈæhæt ˌɛnd‍ʒˈiː kˈa‍ɪlæŋɡən kˈɑːŋ ɪmpˈɔː‍ɹmɐsɪən mjˈʊlə sˈɑː ɪnjˈo‍ʊ`
- Spanish espeak: `nakˈua kˈo nˈa pˈo ˈaŋ laˈat ˌenexˈe ka‍ɪlˈaŋɡaŋ kˈoŋ ˌimpoɾmˈasʝon mˈula sˈa ˈiɲo`
- Character/token frontend: `N a k u h a | k o | n a | p o | a n g | l a h a t | n g | k a i l a n g a n | k o n g | i m p o r m a s y o n | m u l a | s a | i n y o | .`
- Custom language-aware frontend: `N A K U H A | K O | N A | P O | A NG | L A H A T | NG | K A I L A NG A N | K O NG | I M P O R M A S Y O N | M U L A | S A | I N Y O | .`

### 38. Thank you for providing all the necessary information for your account update.

- Tokenized words: `['Thank', 'you', 'for', 'providing', 'all', 'the', 'necessary', 'information', 'for', 'your', 'account', 'update', '.']`
- English espeak: `θˈæŋk juː fɔː‍ɹ pɹəvˈa‍ɪdɪŋ ˈɔːl ðə nˈɛsᵻsɚɹi ˌɪnfɚmˈe‍ɪʃən fɔː‍ɹ jʊɹ ɐkˈa‍ʊnt ˈʌpde‍ɪt`
- Spanish espeak: `tˈaŋk ʝˈow fˈoɾ pɾoβˈiðiŋ ˈaʎ tˈe nˌeθessˈaɾi ˌinfoɾmˈatjon fˈoɾ ʝˈowɾ akkˈownt upðˈate`
- Character/token frontend: `T h a n k | y o u | f o r | p r o v i d i n g | a l l | t h e | n e c e s s a r y | i n f o r m a t i o n | f o r | y o u r | a c c o u n t | u p d a t e | .`
- Custom language-aware frontend: `T H A N K | Y O U | EN<for> | EN<providing> | A L L | EN<the> | EN<necessary> | EN<information> | EN<for> | EN<your> | EN<account> | U P D A T E | .`
- Warnings: `['Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend']`

### 39. Hintayin niyo na lang po ang pagtawag ng aming dispatch team mamaya.

- Tokenized words: `['Hintayin', 'niyo', 'na', 'lang', 'po', 'ang', 'pagtawag', 'ng', 'aming', 'dispatch', 'team', 'mamaya', '.']`
- English espeak: `hˈɪnte‍ɪˌɪn nˈɪjo‍ʊ nˈɑː lˈæŋ pˈo‍ʊ ˈæŋ pˈæɡtɐwˌæɡ ˌɛnd‍ʒˈiː ˈe‍ɪmɪŋ dɪspˈæt‍ʃ tˈiːm mˈæme‍ɪə`
- Spanish espeak: `intˈaʝin nˈiʝo nˈa lˈaŋ pˈo ˈaŋ pˌaɡtawˈaɣ ˌenexˈe ˈamiŋ dispˈatt‍ʃ tˈeam mamˈaʝa`
- Character/token frontend: `H i n t a y i n | n i y o | n a | l a n g | p o | a n g | p a g t a w a g | n g | a m i n g | d i s p a t c h | t e a m | m a m a y a | .`
- Custom language-aware frontend: `H I N T A Y I N | N I Y O | N A | L A NG | P O | A NG | P A G T A W A G | NG | A M I NG | EN<dispatch> | T E A M | M A M A Y A | .`
- Warnings: `['Route through English G2P in final frontend']`

### 40. Two thousand five hundred pesos po ang total ng inyong bibilhin.

- Tokenized words: `['Two', 'thousand', 'five', 'hundred', 'pesos', 'po', 'ang', 'total', 'ng', 'inyong', 'bibilhin', '.']`
- English espeak: `tˈuː θˈa‍ʊzənd fˈa‍ɪv hˈʌndɹɪd pˈe‍ɪso‍ʊz pˈo‍ʊ ˈæŋ tˈo‍ʊɾə‍l ˌɛnd‍ʒˈiː ɪnjˈɑːŋ ba‍ɪbˈɪlhɪn`
- Spanish espeak: `tˌeˌuβe ðˌoβleˈo towsˈand fˈiβe undɾˈed pˈesos pˈo ˈaŋ totˈal ˌenexˈe ˈiɲoŋ biβˈilin`
- Character/token frontend: `T w o | t h o u s a n d | f i v e | h u n d r e d | p e s o s | p o | a n g | t o t a l | n g | i n y o n g | b i b i l h i n | .`
- Custom language-aware frontend: `EN<two> | EN<thousand> | EN<five> | EN<hundred> | P E S O S | P O | A NG | EN<total> | NG | I N Y O NG | B I B I L H I N | .`
- Warnings: `['Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend']`

### 41. We will keep your personal details strictly confidential dito sa aming database.

- Tokenized words: `['We', 'will', 'keep', 'your', 'personal', 'details', 'strictly', 'confidential', 'dito', 'sa', 'aming', 'database', '.']`
- English espeak: `wiː wɪl kˈiːp jʊ‍ɹ pˈɜːsənə‍l diːtˈe‍ɪlz stɹˈɪktli kˌɑːnfɪdˈɛnʃə‍l dˈiːɾo‍ʊ sˈɑː ˈe‍ɪmɪŋ dˈe‍ɪɾəbˌe‍ɪs`
- Spanish espeak: `wˈe wˈiʎ keˈep ʝˈowɾ pˌeɾsonˈal ðetˈa‍ɪls stɾˈiktli kˌonfiðentjˈal ðˈito sˈa ˈamiŋ dˌataβˈase`
- Character/token frontend: `W e | w i l l | k e e p | y o u r | p e r s o n a l | d e t a i l s | s t r i c t l y | c o n f i d e n t i a l | d i t o | s a | a m i n g | d a t a b a s e | .`
- Custom language-aware frontend: `EN<we> | W I L L | K E E P | EN<your> | P E R S O N A L | D E T A I L S | EN<strictly> | EN<confidential> | D I T O | S A | A M I NG | D A T A B A S E | .`
- Warnings: `['Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend']`

### 42. Pwede na po nating i-finalize ang inyong payment para maka-usad na tayo.

- Tokenized words: `['Pwede', 'na', 'po', 'nating', 'i-finalize', 'ang', 'inyong', 'payment', 'para', 'maka-usad', 'na', 'tayo', '.']`
- English espeak: `pˈiːwˈiːd nˈɑː pˈo‍ʊ nˈe‍ɪɾɪŋ ˈa‍ɪfˈa‍ɪnə‍lˌa‍ɪz ˈæŋ ɪnjˈɑːŋ pˈe‍ɪmənt pˈæɹə mˈɑːkəjˈuːzæd nˈɑː tˈe‍ɪo‍ʊ`
- Spanish espeak: `pˈewˈeðe nˈa pˈo nˈatiŋ ˈifˌinalˈiθe ˈaŋ ˈiɲoŋ pa‍ɪmˈɛnt pˌaɾa mˈakausˈad nˈa tˈaʝo`
- Character/token frontend: `P w e d e | n a | p o | n a t i n g | i - f i n a l i z e | a n g | i n y o n g | p a y m e n t | p a r a | m a k a - u s a d | n a | t a y o | .`
- Custom language-aware frontend: `P W E D E | N A | P O | N A T I NG | I EN<finalize> | A NG | I N Y O NG | EN<payment> | P A R A | M A K A U S A D | N A | T A Y O | .`
- Warnings: `['English stem needs English G2P', 'Route through English G2P in final frontend']`

### 43. Iche-check po muna nila nang maigi ang bawat item bago tuluyang ipasok sa kahon.

- Tokenized words: `['Iche-check', 'po', 'muna', 'nila', 'nang', 'maigi', 'ang', 'bawat', 'item', 'bago', 'tuluyang', 'ipasok', 'sa', 'kahon', '.']`
- English espeak: `ˈɪkt‍ʃˈɛk pˈo‍ʊ mˈuːnə nˈiːlə nˈæŋ mˈe‍ɪɡi ˈæŋ bˈæwɑːt ˈa‍ɪɾəm bˈe‍ɪɡo‍ʊ t‍ʃəlˈa‍ɪæŋ ˈɪpɐsˌɑːk sˈɑː kˈæhɑːn`
- Spanish espeak: `ˈit‍ʃet‍ʃˈek pˈo mˈuna nˈila nˈaŋ mˈa‍ɪxi ˈaŋ bawˈat ˈitem bˈaɣo tulˈuʝaŋ ˌipasˈok sˈa kˈaon`
- Character/token frontend: `I c h e - c h e c k | p o | m u n a | n i l a | n a n g | m a i g i | a n g | b a w a t | i t e m | b a g o | t u l u y a n g | i p a s o k | s a | k a h o n | .`
- Custom language-aware frontend: `EN<iche-check> | P O | M U N A | N I L A | N A NG | M A I G I | A NG | B A W A T | I T E M | B A G O | T U L U Y A NG | I P A S O K | S A | K A H O N | .`
- Warnings: `['Route through English G2P in final frontend']`

### 44. Once the system validates your request, ia-arrange na po namin ang pickup.

- Tokenized words: `['Once', 'the', 'system', 'validates', 'your', 'request', ',', 'ia-arrange', 'na', 'po', 'namin', 'ang', 'pickup', '.']`
- English espeak: `wˈʌns ðə sˈɪstəm vˈælᵻdˌe‍ɪts jʊ‍ɹ ɹᵻkwˈɛst
ˈa‍ɪəɚɹˈe‍ɪnd‍ʒ nˈɑː pˈo‍ʊ nˈæmɪn ˈæŋ pˈɪkʌp`
- Spanish espeak: `ˈonθe tˈe sˈistem bˌaliðˈates ʝˈowɾ rekˈest
jˈaarˈaŋxe nˈa pˈo nˈamin ˈaŋ pikˈup`
- Character/token frontend: `O n c e | t h e | s y s t e m | v a l i d a t e s | y o u r | r e q u e s t | , | i a - a r r a n g e | n a | p o | n a m i n | a n g | p i c k u p | .`
- Custom language-aware frontend: `EN<once> | EN<the> | S Y S T E M | EN<validates> | EN<your> | EN<request> | , | I A A R R A NG E | N A | P O | N A M I N | A NG | EN<pickup> | .`
- Warnings: `['Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend']`

### 45. Kung wala na po kayong idadagdag, ipa-process ko na po ito agad.

- Tokenized words: `['Kung', 'wala', 'na', 'po', 'kayong', 'idadagdag', ',', 'ipa-process', 'ko', 'na', 'po', 'ito', 'agad', '.']`
- English espeak: `kˈʌŋ wˈɑːlə nˈɑː pˈo‍ʊ kˈe‍ɪɑːŋ ˈa‍ɪdɐdˌæɡdæɡ
ˌa‍ɪpˌiːˈe‍ɪpɹˈɑːsɛs kˈo‍ʊ nˈɑː pˈo‍ʊ ˈiːɾo‍ʊ ˈæɡæd`
- Spanish espeak: `kˈuŋ wˈala nˈa pˈo kˈaʝoŋ ˌiðaðaɡðˈaɡ
ˈipapɾoθˈess kˈo nˈa pˈo ˈito aɣˈad`
- Character/token frontend: `K u n g | w a l a | n a | p o | k a y o n g | i d a d a g d a g | , | i p a - p r o c e s s | k o | n a | p o | i t o | a g a d | .`
- Custom language-aware frontend: `K U NG | W A L A | N A | P O | K A Y O NG | I D A D A G D A G | , | I P A EN<process> | K O | N A | P O | I T O | A G A D | .`
- Warnings: `['English stem needs English G2P']`

### 46. Mangyaring itago ang inyong reference number para sa mga susunod ninyong transaksyon.

- Tokenized words: `['Mangyaring', 'itago', 'ang', 'inyong', 'reference', 'number', 'para', 'sa', 'mga', 'susunod', 'ninyong', 'transaksyon', '.']`
- English espeak: `mˈænd‍ʒjɛɹɪŋ ɪtˈe‍ɪɡo‍ʊ ˈæŋ ɪnjˈɑːŋ ɹˈɛfɹəns nˈʌmbɚ pˈæɹə sˈɑː ˌɛmd‍ʒˌiːˈe‍ɪ sˈuːzənˌɑːd nˈɪnɪˌɑːŋ tɹænsˈæksɪən`
- Spanish espeak: `maŋxʝˈaɾiŋ itˈaɣo ˈaŋ ˈiɲoŋ rˌefeɾˈɛnθe numbˈeɾ pˌaɾa sˈa ˌemexˌeˈa sˌusunˈod nˈiɲoŋ tɾansˈaksʝon`
- Character/token frontend: `M a n g y a r i n g | i t a g o | a n g | i n y o n g | r e f e r e n c e | n u m b e r | p a r a | s a | m g a | s u s u n o d | n i n y o n g | t r a n s a k s y o n | .`
- Custom language-aware frontend: `M A NG Y A R I NG | I T A G O | A NG | I N Y O NG | EN<reference> | N U M B E R | P A R A | S A | M A NG A | S U S U N O D | N I N Y O NG | T R A N S A K S Y O N | .`
- Warnings: `['Route through English G2P in final frontend']`

### 47. I will now submit your completed order form diretso sa aming warehouse.

- Tokenized words: `['I', 'will', 'now', 'submit', 'your', 'completed', 'order', 'form', 'diretso', 'sa', 'aming', 'warehouse', '.']`
- English espeak: `a‍ɪ wɪl nˈa‍ʊ səbmˈɪt jʊ‍ɹ kəmplˈiːɾᵻd ˈɔː‍ɹdɚ fˈɔː‍ɹm dˈa‍ɪ‍ɚtso‍ʊ sˈɑː ˈe‍ɪmɪŋ wˈɛ‍ɹha‍ʊs`
- Spanish espeak: `ˈi wˈiʎ nˈow submˈit ʝˈowɾ kˌompletˈeð oɾðˈeɾ fˈoɾm diɾˈetso sˈa ˈamiŋ wˌaɾeˈowse`
- Character/token frontend: `I | w i l l | n o w | s u b m i t | y o u r | c o m p l e t e d | o r d e r | f o r m | d i r e t s o | s a | a m i n g | w a r e h o u s e | .`
- Custom language-aware frontend: `I | W I L L | N O W | S U B M I T | EN<your> | EN<completed> | O R D E R | EN<form> | D I R E T S O | S A | A M I NG | W A R E H O U S E | .`
- Warnings: `['Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend']`

### 48. Ilalagay ko na po ito sa listahan ng mga ipapadala natin sa lingo.

- Tokenized words: `['Ilalagay', 'ko', 'na', 'po', 'ito', 'sa', 'listahan', 'ng', 'mga', 'ipapadala', 'natin', 'sa', 'lingo', '.']`
- English espeak: `ˈɪlɐlˌæɡe‍ɪ kˈo‍ʊ nˈɑː pˈo‍ʊ ˈiːɾo‍ʊ sˈɑː lˈɪstɐhˌæn ˌɛnd‍ʒˈiː ˌɛmd‍ʒˌiːˈe‍ɪ ˌɪpɐpɐdˈɑːlə nˈætɪn sˈɑː lˈɪŋɡo‍ʊ`
- Spanish espeak: `ˌilalaɣˈa‍ɪ kˈo nˈa pˈo ˈito sˈa listˈaan ˌenexˈe ˌemexˌeˈa ˌipapaðˈala nˈatin sˈa lˈiŋɡo`
- Character/token frontend: `I l a l a g a y | k o | n a | p o | i t o | s a | l i s t a h a n | n g | m g a | i p a p a d a l a | n a t i n | s a | l i n g o | .`
- Custom language-aware frontend: `I L A L A G A Y | K O | N A | P O | I T O | S A | L I S T A H A N | NG | M A NG A | I P A P A D A L A | N A T I N | S A | L I NG O | .`

### 49. Paki-ready na lang po ang bayad ninyo kapag dumating na ang rider.

- Tokenized words: `['Paki-ready', 'na', 'lang', 'po', 'ang', 'bayad', 'ninyo', 'kapag', 'dumating', 'na', 'ang', 'rider', '.']`
- English espeak: `pˈækiɹˈɛdi nˈɑː lˈæŋ pˈo‍ʊ ˈæŋ bˈe‍ɪæd nˈɪnɪˌo‍ʊ kˈæpæɡ dˈuːme‍ɪɾɪŋ nˈɑː ˈæŋ ɹˈa‍ɪdɚ`
- Spanish espeak: `pˈakireˈaði nˈa lˈaŋ pˈo ˈaŋ baʝˈad nˈiɲo kapˈaɡ ðumˈatiŋ nˈa ˈaŋ riðˈeɾ`
- Character/token frontend: `P a k i - r e a d y | n a | l a n g | p o | a n g | b a y a d | n i n y o | k a p a g | d u m a t i n g | n a | a n g | r i d e r | .`
- Custom language-aware frontend: `P A K I R E A D Y | N A | L A NG | P O | A NG | B A Y A D | N I N Y O | K A P A G | D U M A T I NG | N A | A NG | R I D E R | .`

### 50. Your purchase is now completely logged sa aming main inventory tracking system.

- Tokenized words: `['Your', 'purchase', 'is', 'now', 'completely', 'logged', 'sa', 'aming', 'main', 'inventory', 'tracking', 'system', '.']`
- English espeak: `jʊ‍ɹ pˈɜːt‍ʃɪs ɪz nˈa‍ʊ kəmplˈiːtli lˈɔɡd sˈɑː ˈe‍ɪmɪŋ mˈe‍ɪn ˈɪnvəntˌɔːɹi tɹˈækɪŋ sˈɪstəm`
- Spanish espeak: `ʝˈowɾ puɾt‍ʃˈase ˈis nˈow kˌompletˈeli loɡxˈed sˈa ˈamiŋ mˈa‍ɪn ˌimbentˈoɾi tɾˈakiŋ sˈistem`
- Character/token frontend: `Y o u r | p u r c h a s e | i s | n o w | c o m p l e t e l y | l o g g e d | s a | a m i n g | m a i n | i n v e n t o r y | t r a c k i n g | s y s t e m | .`
- Custom language-aware frontend: `EN<your> | EN<purchase> | EN<is> | N O W | EN<completely> | L O G G E D | S A | A M I NG | M A I N | EN<inventory> | EN<tracking> | S Y S T E M | .`
- Warnings: `['Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend']`

### 51. Titignan po ng aming supervisor ang inyong form bago nila ito pirmahan.

- Tokenized words: `['Titignan', 'po', 'ng', 'aming', 'supervisor', 'ang', 'inyong', 'form', 'bago', 'nila', 'ito', 'pirmahan', '.']`
- English espeak: `tˈɪɾɪɡnən pˈo‍ʊ ˌɛnd‍ʒˈiː ˈe‍ɪmɪŋ sˈuːpɚvˌa‍ɪzɚɹ ˈæŋ ɪnjˈɑːŋ fˈɔː‍ɹm bˈe‍ɪɡo‍ʊ nˈiːlə ˈiːɾo‍ʊ pˈɜːmɐhˌæn`
- Spanish espeak: `titˈiɡnam pˈo ˌenexˈe ˈamiŋ sˌupeɾβisˈoɾ ˈaŋ ˈiɲoŋ fˈoɾm bˈaɣo nˈila ˈito piɾmˈaan`
- Character/token frontend: `T i t i g n a n | p o | n g | a m i n g | s u p e r v i s o r | a n g | i n y o n g | f o r m | b a g o | n i l a | i t o | p i r m a h a n | .`
- Custom language-aware frontend: `T I T I G N A N | P O | NG | A M I NG | EN<supervisor> | A NG | I N Y O NG | EN<form> | B A G O | N I L A | I T O | P I R M A H A N | .`
- Warnings: `['Route through English G2P in final frontend', 'Route through English G2P in final frontend']`

### 52. Ang resibo po ninyo ay ipapadala kasama ng mismong package sa kahon.

- Tokenized words: `['Ang', 'resibo', 'po', 'ninyo', 'ay', 'ipapadala', 'kasama', 'ng', 'mismong', 'package', 'sa', 'kahon', '.']`
- English espeak: `ˈæŋ ɹᵻzᵻbˈo‍ʊ pˈo‍ʊ nˈɪnɪˌo‍ʊ ˈa‍ɪ ˌɪpɐpɐdˈɑːlə kæsˈɑːmə ˌɛnd‍ʒˈiː mɪsmˈɔŋɡ pˈækɪd‍ʒ sˈɑː kˈæhɑːn`
- Spanish espeak: `ˈaŋ resˈiβo pˈo nˈiɲo ˈa‍ɪ ˌipapaðˈala kasˈama ˌenexˈe mˈismoŋ pakˈaxe sˈa kˈaon`
- Character/token frontend: `A n g | r e s i b o | p o | n i n y o | a y | i p a p a d a l a | k a s a m a | n g | m i s m o n g | p a c k a g e | s a | k a h o n | .`
- Custom language-aware frontend: `A NG | R E S I B O | P O | N I N Y O | A Y | I P A P A D A L A | K A S A M A | NG | M I S M O NG | EN<package> | S A | K A H O N | .`
- Warnings: `['Route through English G2P in final frontend']`

### 53. We have successfully updated your shipping preferences para sa inyong future orders.

- Tokenized words: `['We', 'have', 'successfully', 'updated', 'your', 'shipping', 'preferences', 'para', 'sa', 'inyong', 'future', 'orders', '.']`
- English espeak: `wiː hæv səksˈɛsfəli ʌpdˈe‍ɪɾᵻd jʊ‍ɹ ʃˈɪpɪŋ pɹˈɛfɹənsᵻz pˈæɹə sˈɑː ɪnjˈɑːŋ fjˈuːt‍ʃɚɹ ˈɔː‍ɹdɚz`
- Spanish espeak: `wˈe ˈaβe sˌukθessfˈuʎi ˌupðatˈed ʝˈowɾ ʃˈippiŋ pɾˌefeɾˈɛnθes pˌaɾa sˈa ˈiɲoŋ futˈuɾe oɾðˈeɾs`
- Character/token frontend: `W e | h a v e | s u c c e s s f u l l y | u p d a t e d | y o u r | s h i p p i n g | p r e f e r e n c e s | p a r a | s a | i n y o n g | f u t u r e | o r d e r s | .`
- Custom language-aware frontend: `EN<we> | EN<have> | EN<successfully> | U P D A T E D | EN<your> | SY I P P I NG | EN<preferences> | P A R A | S A | I N Y O NG | EN<future> | O R D E R S | .`
- Warnings: `['Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend']`

### 54. Bukas po nang umaga namin sisimulan ang pagbalot ng inyong mga gamit.

- Tokenized words: `['Bukas', 'po', 'nang', 'umaga', 'namin', 'sisimulan', 'ang', 'pagbalot', 'ng', 'inyong', 'mga', 'gamit', '.']`
- English espeak: `bjˈuːkəz pˈo‍ʊ nˈæŋ juːmˈɑːɡə nˈæmɪn sˈɪsɪmjˌʊlæn ˈæŋ pˈæɡbɐlˌɑːt ˌɛnd‍ʒˈiː ɪnjˈɑːŋ ˌɛmd‍ʒˌiːˈe‍ɪ ɡˈæmɪt`
- Spanish espeak: `bˈukas pˈo nˈaŋ umˈaɣa nˈamin sˌisimˈulan ˈaŋ pˌaɡβalˈot ˌenexˈe ˈiɲoŋ ˌemexˌeˈa ɣamˈit`
- Character/token frontend: `B u k a s | p o | n a n g | u m a g a | n a m i n | s i s i m u l a n | a n g | p a g b a l o t | n g | i n y o n g | m g a | g a m i t | .`
- Custom language-aware frontend: `B U K A S | P O | N A NG | U M A G A | N A M I N | S I S I M U L A N | A NG | P A G B A L O T | NG | I N Y O NG | M A NG A | G A M I T | .`

### 55. Tatawag po ulit kami kapag kailangan pa namin ng karagdagang impormasyon mula sa inyo.

- Tokenized words: `['Tatawag', 'po', 'ulit', 'kami', 'kapag', 'kailangan', 'pa', 'namin', 'ng', 'karagdagang', 'impormasyon', 'mula', 'sa', 'inyo', '.']`
- English espeak: `tˈæɾɐwˌæɡ pˈo‍ʊ ˈuːlɪt kˈɑːmi kˈæpæɡ kˈa‍ɪlæŋɡən pˈɑː nˈæmɪn ˌɛnd‍ʒˈiː kˈæɹɐɡdˌæɡæŋ ɪmpˈɔː‍ɹmɐsɪən mjˈʊlə sˈɑː ɪnjˈo‍ʊ`
- Spanish espeak: `tˌatawˈaɡ pˈo ulˈit kˈami kapˈaɡ ka‍ɪlˈaŋɡam pˈa nˈamin ˌenexˈe kˌaɾaɡðˈaɣaŋ ˌimpoɾmˈasʝon mˈula sˈa ˈiɲo`
- Character/token frontend: `T a t a w a g | p o | u l i t | k a m i | k a p a g | k a i l a n g a n | p a | n a m i n | n g | k a r a g d a g a n g | i m p o r m a s y o n | m u l a | s a | i n y o | .`
- Custom language-aware frontend: `T A T A W A G | P O | U L I T | K A M I | K A P A G | K A I L A NG A N | P A | N A M I N | NG | K A R A G D A G A NG | I M P O R M A S Y O N | M U L A | S A | I N Y O | .`

### 56. If you have no further questions, we can end the call right here.

- Tokenized words: `['If', 'you', 'have', 'no', 'further', 'questions', ',', 'we', 'can', 'end', 'the', 'call', 'right', 'here', '.']`
- English espeak: `ɪf juː hæv nˈo‍ʊ fˈɜːðɚ kwˈɛst‍ʃənz
wiː kæn ˈɛnd ðə kˈɔːl ɹˈa‍ɪt hˈɪ‍ɹ`
- Spanish espeak: `ˈif ʝˈow ˈaβe nˈo fuɾtˈeɾ kˈestjons
wˈe kˈan ˈɛnd tˈe kˈaʎ rˈiɣt ˈeɾe`
- Character/token frontend: `I f | y o u | h a v e | n o | f u r t h e r | q u e s t i o n s | , | w e | c a n | e n d | t h e | c a l l | r i g h t | h e r e | .`
- Custom language-aware frontend: `EN<if> | Y O U | EN<have> | N O | EN<further> | EN<questions> | , | EN<we> | EN<can> | E N D | EN<the> | EN<call> | R I G H T | H E R E | .`
- Warnings: `['Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend']`

### 57. Maraming salamat po sa inyong tiwala at pag-order sa aming shop ngayon!

- Tokenized words: `['Maraming', 'salamat', 'po', 'sa', 'inyong', 'tiwala', 'at', 'pag-order', 'sa', 'aming', 'shop', 'ngayon', '!']`
- English espeak: `mˈæɹəmɪŋ sˈælɐmˌæt pˈo‍ʊ sˈɑː ɪnjˈɑːŋ tɪwˈɑːlə æt pˈæɡˈɔː‍ɹdɚ sˈɑː ˈe‍ɪmɪŋ ʃˈɑːp əŋɡˈe‍ɪən`
- Spanish espeak: `maɾˈamiŋ sˌalamˈat pˈo sˈa ˈiɲoŋ tiwˈala ˈat pˈaxinaoɾðˈeɾ sˈa ˈamiŋ ʃˈop ˈɛneɣˈaʝon`
- Character/token frontend: `M a r a m i n g | s a l a m a t | p o | s a | i n y o n g | t i w a l a | a t | p a g - o r d e r | s a | a m i n g | s h o p | n g a y o n | !`
- Custom language-aware frontend: `M A R A M I NG | S A L A M A T | P O | S A | I N Y O NG | T I W A L A | EN<at> | P A G O R D E R | S A | A M I NG | SY O P | NG A Y O N | !`
- Warnings: `['Route through English G2P in final frontend']`

### 58. Yay, confirmed na po ang inyong order at ready na for shipping!

- Tokenized words: `['Yay', ',', 'confirmed', 'na', 'po', 'ang', 'inyong', 'order', 'at', 'ready', 'na', 'for', 'shipping', '!']`
- English espeak: `jˈe‍ɪ
kənfˈɜːmd nˈɑː pˈo‍ʊ ˈæŋ ɪnjˈɑːŋ ˈɔː‍ɹdɚɹ æt ɹˈɛdi nˈɑː fɔː‍ɹ ʃˈɪpɪŋ`
- Spanish espeak: `ʝˈa‍ɪ
kˌonfiɾmˈed nˈa pˈo ˈaŋ ˈiɲoŋ oɾðˈeɾ ˈat reˈaði nˈa fˈoɾ ʃˈippiŋ`
- Character/token frontend: `Y a y | , | c o n f i r m e d | n a | p o | a n g | i n y o n g | o r d e r | a t | r e a d y | n a | f o r | s h i p p i n g | !`
- Custom language-aware frontend: `Y A Y | , | EN<confirmed> | N A | P O | A NG | I N Y O NG | O R D E R | EN<at> | R E A D Y | N A | EN<for> | SY I P P I NG | !`
- Warnings: `['Route through English G2P in final frontend', 'Route through English G2P in final frontend', 'Route through English G2P in final frontend']`

## Recommendation

Do not train on raw English espeak output for Taglish. Continue developing
the language-aware frontend, then use the exact same frontend for training
manifests and CPU production inference.
