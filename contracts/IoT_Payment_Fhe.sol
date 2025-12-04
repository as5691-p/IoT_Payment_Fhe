pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract IotPaymentFhe is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    address public owner;
    mapping(address => bool) public providers;
    bool public paused;
    uint256 public cooldownSeconds;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;

    struct Payment {
        address provider;
        euint32 encryptedAmount;
        uint256 submissionTimestamp;
    }
    Payment[] public payments;

    struct Batch {
        uint256 id;
        uint256 totalEncryptedAmount;
        bool closed;
    }
    Batch[] public batches;

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event PauseToggled(bool paused);
    event CooldownSecondsUpdated(uint256 oldCooldown, uint256 newCooldown);
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId, euint32 totalEncryptedAmount);
    event PaymentSubmitted(uint256 indexed paymentId, uint256 indexed batchId, address indexed provider, euint32 encryptedAmount);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId, bytes32 stateHash);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId, uint256 totalAmount);

    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error BatchClosedOrNonexistent();
    error InvalidBatch();
    error ReplayAttempt();
    error StateMismatch();
    error InvalidProof();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!providers[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    constructor() {
        owner = msg.sender;
        cooldownSeconds = 60; // Default cooldown: 60 seconds
        _initIfNeeded();
    }

    function transferOwnership(address newOwner) external onlyOwner {
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function addProvider(address provider) external onlyOwner {
        providers[provider] = true;
        emit ProviderAdded(provider);
    }

    function removeProvider(address provider) external onlyOwner {
        providers[provider] = false;
        emit ProviderRemoved(provider);
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PauseToggled(_paused);
    }

    function setCooldownSeconds(uint256 newCooldownSeconds) external onlyOwner {
        uint256 oldCooldown = cooldownSeconds;
        cooldownSeconds = newCooldownSeconds;
        emit CooldownSecondsUpdated(oldCooldown, newCooldownSeconds);
    }

    function openBatch() external onlyProvider whenNotPaused {
        if (block.timestamp < lastSubmissionTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        lastSubmissionTime[msg.sender] = block.timestamp;

        uint256 batchId = batches.length;
        batches.push(Batch({ id: batchId, totalEncryptedAmount: FHE.asEuint32(0), closed: false }));
        emit BatchOpened(batchId);
    }

    function submitPayment(uint32 encryptedAmount) external onlyProvider whenNotPaused {
        if (block.timestamp < lastSubmissionTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        lastSubmissionTime[msg.sender] = block.timestamp;

        if (batches.length == 0 || batches[batches.length - 1].closed) {
            revert BatchClosedOrNonexistent();
        }

        Batch storage currentBatch = batches[batches.length - 1];
        euint32 userEncryptedAmount = FHE.asEuint32(encryptedAmount);

        payments.push(Payment({
            provider: msg.sender,
            encryptedAmount: userEncryptedAmount,
            submissionTimestamp: block.timestamp
        }));

        currentBatch.totalEncryptedAmount = FHE.add(currentBatch.totalEncryptedAmount, userEncryptedAmount);
        emit PaymentSubmitted(payments.length - 1, currentBatch.id, msg.sender, userEncryptedAmount);
    }

    function closeBatch() external onlyProvider whenNotPaused {
        if (batches.length == 0 || batches[batches.length - 1].closed) {
            revert BatchClosedOrNonexistent();
        }
        Batch storage currentBatch = batches[batches.length - 1];
        currentBatch.closed = true;
        emit BatchClosed(currentBatch.id, currentBatch.totalEncryptedAmount);
    }

    function requestBatchTotalDecryption(uint256 batchId) external whenNotPaused {
        if (block.timestamp < lastDecryptionRequestTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        lastDecryptionRequestTime[msg.sender] = block.timestamp;

        if (batchId >= batches.length || !batches[batchId].closed) {
            revert InvalidBatch();
        }

        euint32 totalEncryptedAmount = batches[batchId].totalEncryptedAmount;
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(totalEncryptedAmount);

        bytes32 stateHash = _hashCiphertexts(cts);
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);

        decryptionContexts[requestId] = DecryptionContext({
            batchId: batchId,
            stateHash: stateHash,
            processed: false
        });
        emit DecryptionRequested(requestId, batchId, stateHash);
    }

    function myCallback(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        if (decryptionContexts[requestId].processed) {
            revert ReplayAttempt();
        }

        // State Verification: Rebuild cts from current contract storage
        uint256 batchId = decryptionContexts[requestId].batchId;
        if (batchId >= batches.length || !batches[batchId].closed) {
            revert InvalidBatch();
        }
        euint32 totalEncryptedAmount = batches[batchId].totalEncryptedAmount;
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(totalEncryptedAmount);

        bytes32 currentHash = _hashCiphertexts(cts);
        if (currentHash != decryptionContexts[requestId].stateHash) {
            revert StateMismatch();
        }

        // Proof Verification
        if (!FHE.checkSignatures(requestId, cleartexts, proof)) {
            revert InvalidProof();
        }

        // Decode & Finalize
        uint256 totalAmount = abi.decode(cleartexts, (uint256));
        decryptionContexts[requestId].processed = true;
        emit DecryptionCompleted(requestId, batchId, totalAmount);
    }

    function _hashCiphertexts(bytes32[] memory cts) internal pure returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    function _initIfNeeded() internal {
        if (!FHE.isInitialized()) {
            FHE.initialize();
        }
    }

    function _requireInitialized() internal view {
        if (!FHE.isInitialized()) {
            revert("FHE not initialized");
        }
    }
}