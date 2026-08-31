import type { CardLanguage } from './catalog';
import { type SealedProduct } from './sealed';
import { type BrowseTheme } from './theme';
export declare function SealedBrowser({ theme: themeProp, languages, numColumns, onOpen, onAdd, addLabel, }: {
    theme?: Partial<BrowseTheme>;
    /**
     * PIN this surface to specific printings. Omit to follow the shared browse preference, which is
     * what makes the sealed shelf agree with the card shelf beside it; when pinned, the toggle is
     * hidden because the host has already decided.
     */
    languages?: CardLanguage[];
    /** Pin the column count. Omit for the S/M/L steps; passing it hides the size toggle. */
    numColumns?: number;
    /** Open a product. Omitted → tiles are not pressable. */
    onOpen?: (product: SealedProduct) => void;
    /** The corner quick-add. Omitted → no pill, the same way every app-shaped affordance here works. */
    onAdd?: (product: SealedProduct) => void;
    /** Glyph for that pill, if a host wants words instead. */
    addLabel?: string;
}): import("react").JSX.Element;
