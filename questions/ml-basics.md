# Machine Learning Basics Question Bank

Each block below represents a question. Multiple choice options are listed when available.

### Question Q1
Question: Which of the following best describes supervised learning?
Options:
- A) Learning without any labeled data
- B) Learning using labeled input-output pairs
- C) Learning by maximizing exploration in an environment
- D) Learning only from reward signals
Answer: B
Explanation: Supervised learning relies on labeled examples where the correct output is known, enabling models to learn mappings from inputs to outputs.

---

### Question Q2
Question: In a binary classification setting, what does the ROC curve visualize?
Options:
- A) Precision versus recall at different thresholds
- B) Training loss versus validation loss
- C) True positive rate versus false positive rate
- D) Model accuracy over epochs
Answer: C
Explanation: The ROC curve plots the true positive rate against the false positive rate for various threshold settings, describing the trade-off between sensitivity and specificity.

---

### Question Q3
Question: Which metric is most appropriate when dealing with a highly imbalanced classification dataset?
Options:
- A) Accuracy
- B) Mean squared error
- C) F1 score
- D) Euclidean distance
Answer: C
Explanation: The F1 score balances precision and recall, making it more informative than accuracy when class distributions are skewed.

---

### Question Q4
Question: Which statement best describes gradient descent when training neural networks on non-convex loss surfaces?
Options:
- A) It always finds the global minimum because neural networks are convex.
- B) It can converge to local minima or saddle points rather than the global minimum.
- C) It only converges when the loss surface is perfectly flat.
- D) It fails entirely unless the learning rate is zero.
Answer: B
Explanation: Gradient descent follows the local slope of the loss surface, so it can converge to local minima or saddle points instead of the global minimum.

---

### Question Q5
Question: Which regularization technique adds the sum of absolute values of weights to the loss function?
Options:
- A) L1 regularization
- B) L2 regularization
- C) Dropout
- D) Batch normalization
Answer: A
Explanation: L1 regularization (lasso) penalizes the absolute magnitudes of weights, promoting sparsity by driving some weights to zero.

---

### Question Q6
Question: In k-means clustering, what does the "k" represent?
Options:
- A) The maximum number of iterations
- B) The dimensionality of the data
- C) The number of clusters to form
- D) The learning rate
Answer: C
Explanation: The parameter k specifies how many cluster centroids the algorithm should identify in the data.

---

### Question Q7
Question: What is the primary purpose of a validation set during model training?
Options:
- A) To measure performance on completely unseen data
- B) To fine-tune hyperparameters and detect overfitting
- C) To compute the training loss after each epoch
- D) To replace the training set when data is scarce
Answer: B
Explanation: Validation data guides hyperparameter tuning and early stopping by providing performance feedback separate from the training set.

---

### Question Q8
Question: Which technique reduces dimensionality by projecting data onto orthogonal axes that capture the maximum variance?
Options:
- A) Principal component analysis
- B) k-means clustering
- C) Naive Bayes classification
- D) Gradient boosting
Answer: A
Explanation: Principal component analysis (PCA) transforms data into orthogonal components ordered by variance, enabling dimensionality reduction while retaining key structure.

---

### Question Q9
Question: How does a reinforcement learning agent obtain feedback while learning a policy?
Options:
- A) It receives explicit labeled actions for every state from a supervisor.
- B) It interacts with the environment and learns from reward signals.
- C) It clusters unlabeled observations to infer correct actions.
- D) It reads gradients provided directly by a teacher network.
Answer: B
Explanation: Reinforcement learning agents learn from reward signals rather than labeled action outputs, relying on trial-and-error interactions with the environment.

---

### Question Q10
Question: Which of the following problems is typically solved with regression algorithms?
Options:
- A) Predicting whether an email is spam
- B) Grouping news articles by topic
- C) Forecasting next week's sales revenue
- D) Detecting credit card fraud
Answer: C
Explanation: Regression algorithms predict continuous values, such as future sales amounts, whereas the other tasks are classification or clustering problems.
