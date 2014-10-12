function People(name)
{
  this.name=name;
  //对象方法
  this.Introduce=function(){
    alert("My name is "+this.name);
  }
}
//类方法
People.Run=function(){
  alert("I can run");
}
//原型方法
People.prototype.IntroduceChinese=function(){
  alert("我的名字是"+this.name);
}

 

//测试

var p1=new People("Windking");

p1.Introduce();

People.Run();

p1.IntroduceChinese();