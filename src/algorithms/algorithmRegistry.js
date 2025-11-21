import { DijkstraAtobAlgorithm } from './DijkstraAtobAlgorithm.js';
import { CSAAtobAlgorithm } from './CSAAtobAlgorithm.js';

/**
 * Registry of all available routing algorithms
 */
class AlgorithmRegistry {
    constructor() {
        this.algorithms = new Map();
        this.defaultAlgorithm = null;

        // Register all algorithms
        this.register(new DijkstraAtobAlgorithm());
        this.register(new CSAAtobAlgorithm(), true); // Set CSA as default (it's faster)
    }

    /**
     * Register a new algorithm
     * @param {AlgorithmInterface} algorithm - Algorithm instance
     * @param {boolean} setAsDefault - Set as default algorithm
     */
    register(algorithm, setAsDefault = false) {
        const name = algorithm.getName();
        this.algorithms.set(name, algorithm);

        if (setAsDefault || this.defaultAlgorithm === null) {
            this.defaultAlgorithm = name;
        }
    }

    /**
     * Get an algorithm by name
     * @param {string} name - Algorithm name
     * @returns {AlgorithmInterface}
     */
    getAlgorithm(name) {
        if (!name) {
            return this.algorithms.get(this.defaultAlgorithm);
        }

        const algorithm = this.algorithms.get(name);
        if (!algorithm) {
            throw new Error(`Algorithm '${name}' not found`);
        }
        return algorithm;
    }

    /**
     * Get all registered algorithms
     * @returns {Array<{name: string, description: string}>}
     */
    getAllAlgorithms() {
        return Array.from(this.algorithms.values()).map(algo => ({
            name: algo.getName(),
            description: algo.getDescription()
        }));
    }

    /**
     * Get the default algorithm name
     * @returns {string}
     */
    getDefaultAlgorithmName() {
        return this.defaultAlgorithm;
    }

    /**
     * Set the default algorithm
     * @param {string} name - Algorithm name
     */
    setDefaultAlgorithm(name) {
        if (!this.algorithms.has(name)) {
            throw new Error(`Algorithm '${name}' not found`);
        }
        this.defaultAlgorithm = name;
    }
}

// Export singleton instance
export const algorithmRegistry = new AlgorithmRegistry();
