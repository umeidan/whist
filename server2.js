//please read and understand the rules of the game before reading the code. Understanding the code without understanding the rules of the game will be much harder

var http = require('http');
var mysql   = require('mysql');
var express = require('express');
var app = express();  //var app = express.createServer(options); for https
var server = http.createServer(app);
var io = require('socket.io').listen(server);
io.set('log level', 1);io.set('log level', 1);
server.listen(80);

var games = [];
var suits = ["club","diamond","heart","spade"];		
var clients = {};
var lastPublicGame = 0;							//changes only when a new public game is added
var currentGame = 0;							//the game of the client that sent a specific event (being used only when creating a new game after 4 players joines)

io.sockets.on('connection', function (socket) { 			//assigning the users into games

	socket.on('createGame', function(data) {		
		
		if (data.type == 'public') {
			if (games.length > 0 && games[lastPublicGame].players.length < 4){  	//if there is a game which is not full the user joins this game
				games[lastPublicGame].players.push({playerSocket:socket, name:data.name});						
			} else {																	//otherwise a new game is created			
				games.push({players:[{playerSocket:socket, name:data.name}],gameId:games.length-1});					
				lastPublicGame = games.length-1;
			}
			currentGame = lastPublicGame;
			socket.emit('welcome', { gameId:lastPublicGame});
		}
		
		if (data.type == 'startPrivate') {
			games.push({players:[{playerSocket:socket,name:data.name}],gameId:games.length-1});								
			socket.emit('welcome', {gameId:games.length-1,'privateGame':"yes"});
			currentGame =  games.length-1;
		}
		if (data.type == 'joinPrivate') {
			games[data.gameCode].players.push({playerSocket:socket, name:data.name});									
			currentGame = data.gameCode
			socket.emit('welcome', {});
		}
		
		clients[socket.id]={gameIndex:currentGame,player:games[currentGame].players.length-1}		//building a hash table to later be able to quickly locate a user by its socket		
		
		if (games[currentGame].players.length === 4) {		
			var cards = dealCards();
			var names = [];
			for (var i=0;i<4;i++){				
				names.push(games[currentGame].players[i].name);
			}
			for (var i=0;i<4;i++){				
				games[currentGame].players[i].playerSocket.emit('gameFull',{'gameId':currentGame, 'player':i,'names':names});		//telling all the players the game is full								
				//games[currentGame].players[i].playerSocket.emit('cards',cards[i]);				
				games[currentGame].players[i].cards=cards[i];								
			}
			games[currentGame].hand = 0;													//there are 13 hands in a game
			games[currentGame].round = 1;													//there are 13 rounds in a hand
			games[currentGame].turn = 0;													//which player's turn is it
			games[currentGame].gameStatus = "bidding";
			games[currentGame].dealer = 0;													//keeps track of the dealer
			games[currentGame].nextRound = 0;
			games[currentGame].currentRound = [];											//an array that saves the cards thrown on the current round
			games[currentGame].firstSuit = " ";												//the first card to be thrown in a round
			games[currentGame].suitOrder = {};												//property = suit, value = (1/2/3/4), changed in every round to help decide who wins the trick
			games[currentGame].handTricks = {"p0":0,"p1":0,"p2":0,"p3":0};					//the tricks claimed by each player on a specific hand				
			games[currentGame].declarationRound = [];										//saves the all the declarations of a certain hand
			games[currentGame].declarationRound[10] = -1;									//decRound[10] saves the last (and thus highest) declaration made so far in this hand	
			games[currentGame].declarationRound[0]=[];										//each one saves the declarations of a specific player in the process of bidding of a certain hand
			games[currentGame].declarationRound[1]=[];
			games[currentGame].declarationRound[2]=[];
			games[currentGame].declarationRound[3]=[];		
			games[currentGame].trump = "";													//the trump on the current hand
			games[currentGame].secondDeclaration=[0,0,0,0];									//the declarations about the tricks each player thinks he'll get
			games[currentGame].declarationCounter = 1;										//to know when the last player declares; it is 1 becuase when it is being used, one player have already declared
			games[currentGame].declarationSum = 0;											//to check that the last player doesn't add up to 13
			games[currentGame].overUnder = "";												//is the hand under or over
			games[currentGame].handScore=[];												//the score of each player for the hand
			games[currentGame].score=[];													//the score of each player for the game (changes after each hand)		
			games[currentGame].score[0]=[];			
		
			for (var i=0;i<4;i++){	
				games[currentGame].players[i].playerSocket.emit('newHand',{"cards":cards[i],"hand":games[currentGame].hand,"turn":games[currentGame].turn});
			}
		
		}
		
	})
	
													
	
	socket.on('nextRound', function(data) {												//when a player presses next round
		var gameIndex=clients[socket.id].gameIndex;	
		var player=clients[socket.id].player;		
		games[gameIndex].nextRound ++		
		
		if(games[gameIndex].nextRound == 4) {											//if this is the last player to press next round the server initiates a new hand
			var cards = dealCards();
			for (var i=0;i<4;i++){															
				games[gameIndex].players[i].playerSocket.emit('newHand',{"cards":cards[i],"hand":games[gameIndex].hand,"turn":games[gameIndex].turn});
				games[gameIndex].players[i].cards=cards[i];			
			}			
			games[gameIndex].nextRound = 0;
			games[gameIndex].gameStatus = "bidding";	
		}	
	});
	
	socket.on('declaration', function (data) {						//this function handles the declaration, verifies the declaration is legal, saves it and manages the pass declaration
		
		var player=clients[socket.id].player;	
		var gameIndex=clients[socket.id].gameIndex;
		var decRound=games[gameIndex].declarationRound;				
		console.log(gameIndex);
		
		var checkDeclaration = function () {		
			if (player == games[gameIndex].turn && games[gameIndex].gameStatus == "bidding") {																	//is this the player's turn to play?
				if (parseInt(data.declaration)>decRound[10] || data.declaration=="pass") {							//the bid is valid only if it's higher than the last one or the player passes						
					if ( isLastBidder(decRound,player)==1 && decRound[10]== -1 && data.declaration=="pass" ) {		//if all players have passed and this is the first round and this player passes too
						endBidding(gameIndex);					
						//sendAll('finalDeclaration',gameIndex,{"card":"no bid","player":player});
						sendAll('restartHand',gameIndex,{"hand":games[gameIndex].hand});
						setTimeout(function(){
							var cards = dealCards();
							for (var i=0;i<4;i++){															
								games[gameIndex].players[i].playerSocket.emit('newHand',{"cards":cards[i],"hand":games[gameIndex].hand,"turn":games[gameIndex].turn});
								games[gameIndex].players[i].cards=cards[i];	
								games[gameIndex].gameStatus = "bidding";			
							}
						}, 1500);
					}			
					else if (isLastBidder(decRound,player)==1 && decRound[10] != -1 && data.declaration=="pass")	{					//if all the players have passed and this is not the first round and this player passes too
						games[gameIndex].trump = bidArray[decRound[10]].suit;
						games[gameIndex].secondDeclaration[player] = bidArray[decRound[10]].number;						
						sendAll('finalDeclaration',gameIndex,{"card":decRound[10],"player":player,"hand":games[gameIndex].hand,"turn":(games[gameIndex].turn+1)%4});
						endBidding(gameIndex);
					}
					else if (isLastBidder(decRound,player)==1 && data.declaration!="pass")	{											//if all the players have passed and this player declares a bid
						games[gameIndex].trump = bidArray[data.declaration].suit;						
						games[gameIndex].secondDeclaration[player] = bidArray[data.declaration].number;
						sendAll('finalDeclaration',gameIndex,{"card":data.declaration,"player":player,"hand":games[gameIndex].hand,"turn":(games[gameIndex].turn+1)%4});
						endBidding(gameIndex);						
						
					}
					else {						
						decRound[player].push(data.declaration);
						if (data.declaration != "pass"){
							decRound[10] = parseInt(data.declaration);																
						}						
						for (var kuku=games[gameIndex].turn+1;kuku<=games[gameIndex].turn+5;kuku++){								//this is to determine who's turn is it next
							var playerMod=kuku%4;
							if ( decRound[playerMod][decRound[playerMod].length-1] !="pass" ) {										//if the next player didn't pass then it's his turn
								games[gameIndex].turn = (kuku)%4;
								break;
							}
						}
						sendAll('playerDeclared',gameIndex,{"card":data.declaration,"player":player,"hand":games[gameIndex].hand,"turn":games[gameIndex].turn})																								
						console.log(games[gameIndex].turn);
					}
				}
				else {
					socket.emit('bidNotValid',{"lastBid":decRound[10]});
				}
			}						
		}();
			
	});

	
	
	socket.on('secondDeclaration',function (data) {
		var gameIndex=clients[socket.id].gameIndex;	
		var player=clients[socket.id].player;			
		var decSum = games[gameIndex].declarationSum;
		var decCounter = games[gameIndex].declarationCounter;				
		if (player == games[gameIndex].turn  && games[gameIndex].gameStatus == "secondDeclaration") {				//is this the player's turn to play?			
			if (decCounter == 3) {																			//when the third player sends a declaration (he is the last player to declare because we already have one player's declaration from the bidding)
				for (var i=0;i<4;i++) {					
					decSum = parseInt(games[gameIndex].secondDeclaration[i])+decSum;						//sum all the second declarations						
					console.log(i,games[gameIndex].secondDeclaration[i]);
				}
				console.log(decSum);
				if (decSum+parseInt(data.declaration) == 13) {																//it's illegal for the sum to be 13
					socket.emit('not13',{}); 	
				}
				else {
					if (decSum+parseInt(data.declaration) < 13) {games[gameIndex].overUnder = "under"}
					if (decSum+parseInt(data.declaration) > 13) {games[gameIndex].overUnder = "over"}					
					games[gameIndex].secondDeclaration[player] = data.declaration	
					games[gameIndex].turn = (games[gameIndex].turn+1)%4			
					games[gameIndex].declarationCounter = 1;														//restart the declarationCounter
					games[gameIndex].declarationSum = 0;					
					games[gameIndex].gameStatus = "game";
					sendAll('secondDec',gameIndex,{"declaration":data.declaration,"player":player,"lastDec":"yes","turn":games[gameIndex].turn});	
				}				
			}
			else {
				games[gameIndex].declarationCounter = games[gameIndex].declarationCounter+1;
				games[gameIndex].secondDeclaration[player] = data.declaration;					
				games[gameIndex].turn = (games[gameIndex].turn+1)%4;	
				sendAll('secondDec',gameIndex,{"declaration":data.declaration,"player":player,"turn":games[gameIndex].turn});			
			}						
			
		}
	});
	
	socket.on('sentCard', function (data) {					//this function handles the round, verifies that the card is legal, saves it to an object
		var gameIndex=clients[socket.id].gameIndex;			//and when the round is over, checks who wins the round
		var currentRound = games[gameIndex].currentRound;
		var suitOrder = games[gameIndex].suitOrder;
		var player=clients[socket.id].player;	
		
		var checkCard = function () {		
			if (player == games[gameIndex].turn && games[gameIndex].gameStatus == "game") {						//is this the player's turn to play? is this game time (and not bidding..)?
			
				if( currentRound.length===0 || data.suit == currentRound[0].card.suit || hasThisSuit(currentRound[0].card.suit,games[gameIndex].players[player].cards)==false ) {		//if the player is the first to play on the round- all moves are legal, else he has to follow the first player's suit but he has no cards of this suit, he can throw whatever he wants
					for (i=0;i<games[gameIndex].players[player].cards.length;i++) {					
							if (games[gameIndex].players[player].cards[i].suit == data.suit && games[gameIndex].players[player].cards[i].number == data.number) {		//check that he actually has the card and not sending a fake card
								games[gameIndex].players[player].cards.splice(i,1);																						//removes the card from the player's cards
								currentRound.push({"player":player,"card":data,"turnOnRound":currentRound.length});														//adds it to the currentRound								
								games[gameIndex].turn = (games[gameIndex].turn+1)%4						//turn is moving clockwise														
								socket.emit('cardApprovel',{"check":"ok","card":data,"turn":games[gameIndex].turn})
								for (var i=0;i<games[gameIndex].players.length;i++){
									if (i != clients[socket.id].player){
										games[gameIndex].players[i].playerSocket.emit('thrownCard', {"player":player,"card":data,"turn":games[gameIndex].turn});			//sends the card to all the players
									}
								}								
							}					
					}
				}
			}	
			
			if (currentRound.length == 1) {							//the first card thrown determines the suit of the round
				games[gameIndex].firstSuit = data.suit;				
			}
			if (currentRound.length == 4) {							//when the fourth player throws a card				
				suitOrder["heart"]=0;
				suitOrder["spade"]=0;
				suitOrder["diamond"]=0;
				suitOrder["club"]=0;
				
				suitOrder[games[gameIndex].firstSuit] = 1 ;								//first suit is always stronger unless the other suit is the trump
				suitOrder[games[gameIndex].trump] = 2 ;									//the trump	is always stronger than any other suit					
				
				currentRound.sort(function(a,b){										//sorting the currentRound to decide who wins the trick
					if (suitOrder[a.card.suit] != suitOrder[b.card.suit]){
						return (suitOrder[a.card.suit] > suitOrder[b.card.suit] ? 1 : -1);	
					}
					return parseInt(a.card.number) - parseInt(b.card.number);
				});				
				
				games[gameIndex].handTricks["p"+currentRound[3].player]++							//the player who's placed highest in the currentRound wins the trick
				games[gameIndex].turn = currentRound[3].player;									//the winner is also the next to start												
				sendAll('endOfRound',gameIndex,{'currentRound':currentRound,"winner":currentRound[3].player,"tricks":games[gameIndex].handTricks["p"+currentRound[3].player]});			
				currentRound.length = 0;																		//the currentRound is cleared
				
				if (games[gameIndex].round == 13) {									//if this is the last round of the hand							
					calculateScores(gameIndex,games[gameIndex].hand);
					console.log(games[gameIndex].score[0]);					
					for (var i=0;i<games[gameIndex].players.length;i++){
						games[gameIndex].players[i].playerSocket.emit('handScores', { handTricks:games[gameIndex].handTricks,handScore:games[gameIndex].handScore,score:games[gameIndex].score[games[gameIndex].hand],hand:games[gameIndex].hand});
					}
					games[gameIndex].hand++;
					games[gameIndex].score[games[gameIndex].hand]=[];
					games[gameIndex].dealer = games[gameIndex].hand%4;
					games[gameIndex].turn = games[gameIndex].dealer;
					games[gameIndex].round = 1;											//restarting the round count
					games[gameIndex].handTricks = {"p0":0,"p1":0,"p2":0,"p3":0};		//and the tricks count
					games[gameIndex].secondDeclaration = [0,0,0,0];						//and the declarations	
					games[gameIndex].gameStatus = "bidding";		
				}
				else {
					games[gameIndex].round ++;									//moving to the next round
				}
			}		
		}();		
		
	});
	socket.on('chatText', function(data) {	
		var gameIndex=clients[socket.id].gameIndex;					
		var player=clients[socket.id].player;			
		sendAll('someoneSays',gameIndex,{text:data.text,player:player});
	});
	
});


function addHashToKey (object) {							//adds # to each key name in order to prevent problems later
	for (key in object ){
		object["#"+key]=object[key];
		delete object[key];			
	}	
}

function sendAll(eventname,gameIndex,data){										//send all the players of the games an event
	for (var i=0;i<games[gameIndex].players.length;i++){					
		games[gameIndex].players[i].playerSocket.emit(eventname,data);								
	}	
}

function isLastBidder(array,player) {												//checks if a player is the last one to bid, i.e. - all other players have passed
	var counter = 0;
	for (var i=0;i<4;i++) {		
		if (i==player) continue;		
		if (array[i].length > 0 && array[i][array[i].length-1]=="pass") {counter++}		
	}
	if (counter==3) {return 1} else {return 0}
}


function dealCards () {					//deals new cards and sends each player his cards

	var numbers = [2,3,4,5,6,7,8,9,10,11,12,13,14];				//11=J,12=Q,13=K,14=A
	var suits = ['club', 'spade', 'heart', 'diamond'];
	var allCards = [];
	var counter = 1;
	for (var number=0;number<13;number++){						//creating an array (allCards) of all the cards where each card is an object with a suit member and a number member
		for (suit=0;suit<4;suit++) {
			allCards.push({number:numbers[number],suit:suits[suit],'counter':counter});
			counter++	
		}
	}
	
	var dealtCards = [[],[],[],[]];			//an array containg arrays that contain the cards that are dealt to each player
	var cardCount=51;
	
	for (var p=0;p<4;p++){	
		for (var i=0;i<13;i++) {
			cardIndex = Math.round(Math.random()*(cardCount));			//choose a random card			
			dealtCards[p].push(allCards[cardIndex]);					//give card to player
			allCards.splice(cardIndex,1);								//and remove it from the deck
			cardCount = cardCount-1;									
		}
	}	
	
	return dealtCards;
}

function hasThisSuit (suit,array) {					//checks if a player has at least one card of a certain suit
	counter = 0;
	for (i=0;i<array.length;i++) {
		if (array[i].suit == suit) {counter++}		
	}
	if (counter===0) {return false}
	else {return true}
}


function biddingArray () {							//creates an array for the bidding like the one in the server to be able to translate the card index from the bidding to suit and number
	biddingArray=[];
	counter=0;	
	for (i=5;i<14;i++) {
		for (s=0;s<4;s++) {
			biddingArray[counter] = {};
			biddingArray[counter].number=i;
			biddingArray[counter].suit=suits[s];
			biddingArray[counter].cardIndex=counter;
			counter++;	
		}	
	}
	return biddingArray
}

function calculateScores (gameIndex,hand) { 			//calculates the scores aff all the players after a specific hand. 
	
	for (var i=0;i<4;i++) {
		if (parseInt(games[gameIndex].secondDeclaration[i]) != 0) {															//different scoring for 0 and for other declarations
			
			if (parseInt(games[gameIndex].handTricks["p"+i]) === parseInt(games[gameIndex].secondDeclaration[i])) {			//if the player succeeded
				games[gameIndex].handScore[i] = Math.pow(parseInt(games[gameIndex].handTricks["p"+i]),2)+10;				//score=tricks^2+10
			}
			else { 
			games[gameIndex].handScore[i] = Math.abs(parseInt(games[gameIndex].handTricks["p"+i]) - parseInt(games[gameIndex].secondDeclaration[i]))*(-10);	//not succeeded, tricks = -10 for any missed trick (too many or too little)
			}
			console.log("tricks: "+parseInt(games[gameIndex].handTricks["p"+i])+" dec: "+parseInt(games[gameIndex].secondDeclaration[i]))
		}		
		else {				//player declared 0
		
			if (parseInt(games[gameIndex].handTricks["p"+i]) == parseInt(games[gameIndex].secondDeclaration[i]) && games[gameIndex].overUnder == "under") {		//succeeded in under game
				games[gameIndex].handScore[i] = 50;
			}
			else if (parseInt(games[gameIndex].handTricks["p"+i]) === parseInt(games[gameIndex].secondDeclaration[i]) && games[gameIndex].overUnder == "over") {	//succeeded in over game
				games[gameIndex].handScore[i] = 25;
			}
			else if (parseInt(games[gameIndex].handTricks["p"+i]) != parseInt(games[gameIndex].secondDeclaration[i]) && games[gameIndex].overUnder == "over") {	//not succeeded in over game
				games[gameIndex].handScore[i] = -25;
			}
			else {																										//not succeeded in under game
				games[gameIndex].handScore[i] = -50 + (parseInt(games[gameIndex].handTricks["p"+i])-1)*10;				//-50 for the first trick and +10 for each extra trick
			}
			
		}
		if (hand===0){
				games[gameIndex].score[hand][i] = games[gameIndex].handScore[i];				
			}
		else {
				games[gameIndex].score[hand][i] = games[gameIndex].score[hand-1][i]+games[gameIndex].handScore[i];			
		}	
	}	
	
}

function endBidding(gameIndex) {									//things that have to take place when the bidding ends
	games[gameIndex].declarationRound[10] = -1;						//clear the declaration round			
	games[gameIndex].declarationRound[0]=[];										
	games[gameIndex].declarationRound[1]=[];
	games[gameIndex].declarationRound[2]=[];
	games[gameIndex].declarationRound[3]=[];	
	
	games[gameIndex].turn = (games[gameIndex].turn+1)%4;			//move turn
	games[gameIndex].gameStatus = "secondDeclaration";				//change game status
}

bidArray = biddingArray();											

app.use('/', express.static(__dirname + '/public')); 
app.get('/', function(req, res){
  res.redirect('/client.htm');
});

